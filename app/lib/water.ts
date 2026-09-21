import "server-only";
import { prisma } from "./prisma";
import { sendPushToUser } from "./push";
import { sendSms } from "./sms";

/**
 * Water meter readings, turned into charges.
 *
 * In most Kenyan apartment blocks water is billed on its own line each month:
 * someone reads every unit's meter, subtracts last month's figure, multiplies
 * the difference by the tariff, and adds that to the tenant's bill. Doing it
 * on paper is where the errors and the disputes come from, so this makes the
 * reading the single source of truth and raises the WATER charge from it.
 *
 * Rules worth knowing (each one is a real-world failure mode):
 *  - The first reading for a unit is a baseline: there is nothing to subtract
 *    it from, so it bills nothing. (Or enter last month's figure alongside it
 *    and it bills straight away.)
 *  - A reading lower than the last one is refused — a meter doesn't run
 *    backwards. If the meter was replaced, the new meter's opening figure is
 *    given and consumption is measured from that.
 *  - Saving the same unit and month again corrects the reading and updates
 *    the SAME charge; it can never raise a second one.
 *  - A vacant unit's reading is recorded (the meter still turns) but there is
 *    nobody to bill, so no charge is raised.
 *  - Rate and consumption are stored with the reading as they were, so a
 *    tariff change later never rewrites a bill already issued.
 *  - An unusually large jump against last month is flagged, not blocked — a
 *    leak or a misread digit is worth a second look before the tenant sees it.
 */

const MONTH_LABEL = (period: string) =>
  new Date(`${period}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });

export const isPeriod = (p: string) => /^\d{4}-(0[1-9]|1[0-2])$/.test(p);

export function periodBounds(period: string) {
  const [y, m] = period.split("-").map(Number);
  return { start: new Date(Date.UTC(y, m - 1, 1)), end: new Date(Date.UTC(y, m, 0, 23, 59, 59, 999)) };
}

export function previousPeriod(period: string) {
  const [y, m] = period.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 2, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** What a month's consumption costs — never below the property's monthly minimum. */
export function waterAmount(consumption: number, rate: number, minCharge: number) {
  return Math.round(Math.max(consumption * rate, minCharge));
}

const trim = (n: number) => String(Math.round(n * 100) / 100);

export type ReadingInput = {
  unitId: string;
  reading: number;
  /** The new meter's starting figure, when the meter has been replaced. */
  opening?: number | null;
  /** Last month's figure, for a unit with no history yet, so it can bill straight away. */
  seed?: number | null;
};

export type RecordResult = {
  saved: number;
  billed: number;
  billedTotal: number;
  baselines: string[];
  flagged: string[];
  errors: string[];
  notices: { leaseId: string; text: string }[];
};

export async function recordReadings(
  organizationId: string,
  period: string,
  inputs: ReadingInput[],
  opts: { userId: string; propertyId?: string | null },
): Promise<RecordResult> {
  const result: RecordResult = { saved: 0, billed: 0, billedTotal: 0, baselines: [], flagged: [], errors: [], notices: [] };
  if (!isPeriod(period) || inputs.length === 0) return result;
  const { start, end } = periodBounds(period);
  const unitIds = inputs.map((i) => i.unitId);

  const units = await prisma.unit.findMany({
    where: { id: { in: unitIds }, organizationId, ...(opts.propertyId ? { propertyId: opts.propertyId } : {}) },
    include: { property: { select: { name: true, waterRate: true, waterMinCharge: true } } },
  });
  const byId = new Map(units.map((u) => [u.id, u]));

  const readings = await prisma.meterReading.findMany({
    where: { unitId: { in: unitIds }, period: { lte: period } },
    orderBy: { period: "desc" },
  });
  const leases = await prisma.lease.findMany({
    where: { unitId: { in: unitIds }, organizationId, startDate: { lte: end }, OR: [{ endDate: null }, { endDate: { gte: start } }] },
    orderBy: { startDate: "desc" },
    select: { id: true, unitId: true, status: true, endDate: true },
  });

  for (const input of inputs) {
    const unit = byId.get(input.unitId);
    if (!unit) {
      result.errors.push("A unit in the list isn't one you can record readings for.");
      continue;
    }
    const where = `${unit.property.name} ${unit.label}`;
    if (unit.property.waterRate === null) {
      result.errors.push(`${where}: no water rate is set for ${unit.property.name} yet.`);
      continue;
    }
    if (!Number.isFinite(input.reading) || input.reading < 0) {
      result.errors.push(`${where}: enter the meter reading as a number, zero or more.`);
      continue;
    }

    const mine = readings.filter((r) => r.unitId === unit.id);
    const existing = mine.find((r) => r.period === period) ?? null;
    const last = mine.find((r) => r.period < period) ?? null;
    const lease = leases.find((l) => l.unitId === unit.id && !(l.status === "ENDED" && !l.endDate)) ?? null;
    const rate = unit.property.waterRate;

    // Work out what this reading is measured from.
    let previous: number;
    let opening: number | null = null;
    let seedToCreate: number | null = null;
    let baseline = false;

    if (last) {
      previous = last.reading;
    } else if (input.seed !== null && input.seed !== undefined && Number.isFinite(input.seed)) {
      if (input.seed < 0 || input.seed > input.reading) {
        result.errors.push(`${where}: last month's figure (${input.seed}) can't be more than this month's (${input.reading}).`);
        continue;
      }
      previous = input.seed;
      seedToCreate = input.seed;
    } else {
      previous = input.reading;
      baseline = true; // nothing to subtract it from
    }

    let consumption = input.reading - previous;
    if (consumption < 0) {
      if (input.opening !== null && input.opening !== undefined && Number.isFinite(input.opening) && input.opening >= 0 && input.opening <= input.reading) {
        opening = input.opening;
        consumption = input.reading - opening;
      } else {
        result.errors.push(
          `${where}: ${trim(input.reading)} is lower than the last reading (${trim(previous)}). If the meter was replaced, enter the new meter's opening figure.`,
        );
        continue;
      }
    }

    const billable = !baseline && Boolean(lease);
    const amount = billable ? waterAmount(consumption, rate, unit.property.waterMinCharge) : 0;
    const data = {
      reading: input.reading,
      previous,
      opening,
      consumption,
      rate,
      amount,
      readAt: new Date(),
      recordedById: opts.userId,
    };
    // Written as relation connects because the charge is created INSIDE the
    // reading's own write — one atomic operation, so a reading can never exist
    // without the charge it is meant to have, or the reverse.
    const chargeData = lease
      ? {
          organization: { connect: { id: organizationId } },
          lease: { connect: { id: lease.id } },
          type: "WATER",
          amount,
          periodMonth: start,
          description: `Water ${MONTH_LABEL(period)} — ${trim(consumption)} units @ KES ${trim(rate)}`,
        }
      : null;

    try {
      // A unit with no history and a supplied last-month figure: record that
      // figure as the previous month's baseline first, so history is complete.
      if (seedToCreate !== null) {
        await prisma.meterReading.upsert({
          where: { unitId_period: { unitId: unit.id, period: previousPeriod(period) } },
          create: {
            organizationId, unitId: unit.id, period: previousPeriod(period), reading: seedToCreate, previous: seedToCreate,
            consumption: 0, rate, amount: 0, recordedById: opts.userId,
          },
          update: {},
        });
      }

      let changedAmount = false;
      if (existing) {
        if (amount > 0 && chargeData) {
          if (existing.chargeId) {
            await prisma.meterReading.update({
              where: { id: existing.id },
              data: { ...data, charge: { update: { amount, description: chargeData.description } } },
            });
          } else {
            await prisma.meterReading.update({ where: { id: existing.id }, data: { ...data, charge: { create: chargeData } } });
          }
          changedAmount = existing.amount !== amount;
        } else if (existing.chargeId) {
          // Corrected down to nothing: remove the charge — unless a payment
          // has already been pointed at it, in which case zero it instead.
          const allocated = await prisma.paymentAllocation.count({ where: { chargeId: existing.chargeId } });
          if (allocated > 0) {
            await prisma.$transaction([
              prisma.charge.update({ where: { id: existing.chargeId }, data: { amount: 0 } }),
              prisma.meterReading.update({ where: { id: existing.id }, data }),
            ]);
          } else {
            await prisma.$transaction([
              prisma.charge.delete({ where: { id: existing.chargeId } }),
              prisma.meterReading.update({ where: { id: existing.id }, data }),
            ]);
          }
          changedAmount = existing.amount !== 0;
        } else {
          await prisma.meterReading.update({ where: { id: existing.id }, data });
        }
      } else {
        await prisma.meterReading.create({
          data: {
            organization: { connect: { id: organizationId } },
            unit: { connect: { id: unit.id } },
            period,
            ...data,
            ...(amount > 0 && chargeData ? { charge: { create: chargeData } } : {}),
          },
        });
        changedAmount = amount > 0;
      }

      result.saved++;
      if (baseline) result.baselines.push(where);
      if (amount > 0) {
        result.billed++;
        result.billedTotal += amount;
        if (changedAmount && lease) {
          result.notices.push({
            leaseId: lease.id,
            text: `Water for ${where}, ${MONTH_LABEL(period)}: ${trim(consumption)} units at KES ${trim(rate)} = KES ${amount.toLocaleString("en-KE")}.`,
          });
        }
      }
      const lastConsumption = last?.consumption ?? 0;
      if (lastConsumption > 0 && consumption > 2.5 * lastConsumption && consumption - lastConsumption >= 5) {
        result.flagged.push(`${where} (${trim(consumption)} units, was ${trim(lastConsumption)})`);
      }
    } catch (e) {
      result.errors.push(`${where}: could not be saved (${e instanceof Error ? e.message : "error"}).`);
    }
  }
  return result;
}

/** Tells each billed tenant, best-effort: an app notification, and an SMS where SMS is set up. Never blocks or fails the save. */
export async function notifyWaterBills(notices: RecordResult["notices"]) {
  for (const n of notices) {
    try {
      const lease = await prisma.lease.findUnique({
        where: { id: n.leaseId },
        select: { tenant: { select: { phone: true, user: { select: { id: true, deviceTokens: { select: { id: true } } } } } } },
      });
      const t = lease?.tenant;
      if (!t) continue;
      if (t.user && t.user.deviceTokens.length > 0) await sendPushToUser(t.user.id, { title: "Water bill", body: n.text }).catch(() => {});
      if (t.phone) await sendSms(t.phone, n.text).catch(() => false);
    } catch {
      // A notification failing must never undo or hide a saved bill.
    }
  }
}

/** Everything the reading sheet shows: each unit with its last figure, this month's reading and who lives there. */
export async function getWaterSheet(organizationId: string, period: string, propertyId?: string | null) {
  const { start, end } = periodBounds(period);
  const properties = await prisma.property.findMany({
    where: { organizationId, ...(propertyId ? { id: propertyId } : {}) },
    orderBy: { name: "asc" },
    include: { units: { orderBy: { label: "asc" } } },
  });
  const unitIds = properties.flatMap((p) => p.units.map((u) => u.id));

  const [readings, leases] = await Promise.all([
    prisma.meterReading.findMany({ where: { unitId: { in: unitIds }, period: { lte: period } }, orderBy: { period: "desc" } }),
    prisma.lease.findMany({
      where: { unitId: { in: unitIds }, startDate: { lte: end }, OR: [{ endDate: null }, { endDate: { gte: start } }] },
      orderBy: { startDate: "desc" },
      select: { unitId: true, status: true, endDate: true, tenant: { select: { name: true } } },
    }),
  ]);

  return properties.map((p) => ({
    id: p.id,
    name: p.name,
    waterRate: p.waterRate,
    waterMinCharge: p.waterMinCharge,
    units: p.units.map((u) => {
      const mine = readings.filter((r) => r.unitId === u.id);
      const lease = leases.find((l) => l.unitId === u.id && !(l.status === "ENDED" && !l.endDate)) ?? null;
      return {
        id: u.id,
        label: u.label,
        tenant: lease?.tenant.name ?? null,
        last: mine.find((r) => r.period < period) ?? null,
        current: mine.find((r) => r.period === period) ?? null,
      };
    }),
  }));
}
