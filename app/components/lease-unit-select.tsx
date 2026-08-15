"use client";

import { useState } from "react";

type UnitOption = { id: string; label: string; propertyName: string; monthlyRent: number | null };

/**
 * Picking a unit fills the rent field from that unit's own expected rent
 * (set once, under Properties) instead of asking staff to retype a figure
 * already on file. Still editable — a lease's rent can differ from the
 * unit's listed rent.
 */
export function LeaseUnitSelect({ units, defaultUnitId }: { units: UnitOption[]; defaultUnitId?: string }) {
  const [rent, setRent] = useState<number | "">(
    units.find((u) => u.id === defaultUnitId)?.monthlyRent ?? "",
  );

  return (
    <>
      <select
        name="unitId"
        required
        defaultValue={defaultUnitId ?? ""}
        onChange={(e) => {
          const unit = units.find((u) => u.id === e.target.value);
          setRent(unit?.monthlyRent ?? "");
        }}
        className="rounded border px-3 py-2"
      >
        <option value="">Select unit</option>
        {units.map((u) => (
          <option key={u.id} value={u.id}>
            {u.propertyName} / {u.label}
            {u.monthlyRent ? ` — ${u.monthlyRent.toLocaleString()}` : ""}
          </option>
        ))}
      </select>
      <div>
        <input
          name="monthlyRent"
          type="number"
          step="0.01"
          required
          placeholder="Monthly rent"
          value={rent}
          onChange={(e) => setRent(e.target.value === "" ? "" : Number(e.target.value))}
          className="w-full rounded border px-3 py-2"
        />
        <p className="mt-1 text-xs text-silver-dark">Filled in from the unit's expected rent — adjust only if this lease differs.</p>
      </div>
    </>
  );
}
