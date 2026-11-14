import { Button, Surface } from "@heroui/react";

export function TripBar({ summary, onEdit }: { summary: string; onEdit: () => void }) {
  return (
    <Surface className="flex items-center gap-2 rounded-full bg-white px-4 py-1 shadow-md" variant="default">
      <p className="min-w-0 flex-1 truncate text-sm font-medium text-[#1C1917]">{summary}</p>
      <Button className="h-11 min-h-11 shrink-0" size="sm" variant="ghost" onPress={onEdit}>
        Edit
      </Button>
    </Surface>
  );
}
