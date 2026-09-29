import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "../ui/empty.tsx";

export function EmptyState(
  { title, description, action }: {
    title: string;
    description: string;
    action?: React.ReactNode;
  },
) {
  return (
    <Empty className="px-4 py-12">
      <EmptyHeader>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
      {action && <EmptyContent>{action}</EmptyContent>}
    </Empty>
  );
}
