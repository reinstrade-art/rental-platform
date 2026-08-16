"use client";

export function DeleteButton({ confirmText, label = "Delete" }: { confirmText: string; label?: string }) {
  return (
    <button
      type="submit"
      className="text-xs underline text-red-600"
      onClick={(e) => {
        if (!confirm(confirmText)) e.preventDefault();
      }}
    >
      {label}
    </button>
  );
}
