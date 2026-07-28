// Training Materials — static reference documents for onboarding/training,
// served directly from /public/training-materials since these are uploaded
// once by an admin and don't need database-backed metadata. Add a new entry
// to TRAINING_MATERIALS below whenever a new file is dropped into that folder.

interface TrainingMaterial {
  title: string;
  description: string;
  href: string;
  fileType: string;
}

const TRAINING_MATERIALS: TrainingMaterial[] = [
  {
    title: "Training Guidelines Deck",
    description: "Onboarding and usage guidelines for the Mondial Portal.",
    href: "/training-materials/Training_Guidelines_Deck.pptx",
    fileType: "PowerPoint (.pptx)",
  },
];

export default function TrainingMaterialsPage() {
  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Training Materials</h1>
          <p className="page-subtitle">Reference documents for onboarding and using the portal.</p>
        </div>
      </div>

      <div className="card mt-6">
        {TRAINING_MATERIALS.length === 0 ? (
          <p className="text-sm text-gray-400">No training materials uploaded yet.</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {TRAINING_MATERIALS.map((item) => (
              <li key={item.href} className="flex items-center justify-between gap-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-gray-800">{item.title}</p>
                  <p className="truncate text-xs text-gray-500">{item.description}</p>
                  <p className="text-xs text-gray-400">{item.fileType}</p>
                </div>
                <a
                  href={item.href}
                  download
                  className="tab-button tab-button-inactive flex-shrink-0"
                >
                  Download
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
