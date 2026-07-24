export default function ComingSoon({
  title,
  description,
}: {
  title: string;
  description?: string;
}) {
  return (
    <div className="card flex flex-col items-center justify-center py-24 text-center">
      <h1 className="text-2xl font-semibold text-gray-800">{title}</h1>
      <p className="mt-2 max-w-md text-sm text-gray-500">
        {description ?? "This module is coming soon in a future build pass."}
      </p>
    </div>
  );
}
