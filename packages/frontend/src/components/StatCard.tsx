interface StatCardProps {
  label: string;
  value: string;
  id?: string;
}

export function StatCard({ label, value, id }: StatCardProps) {
  return (
    <div className="bg-slate-50 dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 p-3 sm:p-4">
      <div className="text-xs text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-1">
        {label}
      </div>
      <div
        className="text-lg sm:text-xl font-semibold text-slate-900 dark:text-white"
        id={id}
      >
        {value}
      </div>
    </div>
  );
}
