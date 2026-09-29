import type { Dispatch, JSX, ReactNode, SetStateAction } from "react";
import {
  type ColumnDef,
  flexRender,
  getCoreRowModel,
  type RowSelectionState,
  useReactTable,
} from "@tanstack/react-table";
import { MoreHorizontal, Plus, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "./ui/button.tsx";
import { Checkbox } from "./ui/checkbox.tsx";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "./ui/table.tsx";

export function ResourceToolbar({
  title,
  addLabel,
  selectedIds,
  busy,
  onAdd,
  onDelete,
}: {
  title: string;
  addLabel: string;
  selectedIds: string[];
  busy: boolean;
  onAdd: () => void;
  onDelete: (ids: string[]) => Promise<void>;
}): JSX.Element {
  const { t } = useTranslation();
  return (
    <div className="section-head list-heading">
      <h2 className="mb-0">{title}</h2>
      {selectedIds.length
        ? (
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">
              {t("table.selected", { count: selectedIds.length })}
            </span>
            <Button
              variant="destructive"
              disabled={busy}
              onClick={() => {
                if (
                  confirm(
                    t("table.deleteConfirm", { count: selectedIds.length }),
                  )
                ) {
                  void onDelete(selectedIds);
                }
              }}
            >
              {t("table.deleteSelected")}
              <Trash2 aria-hidden="true" />
            </Button>
          </div>
        )
        : (
          <Button disabled={busy} onClick={onAdd}>
            {addLabel}
            <Plus aria-hidden="true" />
          </Button>
        )}
    </div>
  );
}

export function ResourceTable<T extends { id: string }>({
  data,
  columns,
  name,
  empty,
  busy,
  onEdit,
  rowActions,
  rowSelection,
  onRowSelectionChange,
  statusSort,
}: {
  data: T[];
  columns: ColumnDef<T>[];
  name: (row: T) => string;
  empty: string;
  busy: boolean;
  onEdit: (row: T) => void;
  rowActions?: (row: T) => ReactNode;
  rowSelection: RowSelectionState;
  onRowSelectionChange: Dispatch<SetStateAction<RowSelectionState>>;
  statusSort?: "asc" | "desc" | null;
}): JSX.Element {
  const { t } = useTranslation();
  const table = useReactTable({
    data,
    columns: [
      {
        id: "select",
        header: ({ table }) => (
          <Checkbox
            aria-label={t("table.selectPage")}
            disabled={busy || !data.length}
            checked={table.getIsAllPageRowsSelected() ||
              (table.getIsSomePageRowsSelected() && "indeterminate")}
            onCheckedChange={(value) =>
              table.toggleAllPageRowsSelected(value === true)}
          />
        ),
        cell: ({ row }) => (
          <Checkbox
            aria-label={t("table.selectRow", { name: name(row.original) })}
            disabled={busy}
            checked={row.getIsSelected()}
            onCheckedChange={(value) => row.toggleSelected(value === true)}
          />
        ),
      },
      ...columns,
      {
        id: "actions",
        header: () => <span className="sr-only">{t("table.actions")}</span>,
        cell: ({ row }) => (
          <div className="flex items-center justify-end gap-0.5">
            {rowActions?.(row.original)}
            <Button
              variant="ghost"
              size="icon"
              disabled={busy}
              aria-label={t("table.configure", { name: name(row.original) })}
              onClick={() => onEdit(row.original)}
            >
              <MoreHorizontal aria-hidden="true" />
            </Button>
          </div>
        ),
      },
    ],
    state: { rowSelection },
    onRowSelectionChange,
    getRowId: (row) => row.id,
    getCoreRowModel: getCoreRowModel(),
    enableRowSelection: true,
    manualPagination: true,
  });
  return (
    <div className="overflow-hidden rounded-md border">
      <Table>
        <TableHeader>
          {table.getHeaderGroups().map((group) => (
            <TableRow key={group.id}>
              {group.headers.map((header) => (
                <TableHead
                  key={header.id}
                  aria-sort={header.column.id === "status"
                    ? statusSort === "asc"
                      ? "ascending"
                      : statusSort === "desc"
                      ? "descending"
                      : "none"
                    : undefined}
                  className={header.column.id === "actions"
                    ? rowActions
                      ? "sticky right-0 w-24 bg-background"
                      : "sticky right-0 w-12 bg-background"
                    : header.column.id === "select"
                    ? "w-10"
                    : undefined}
                >
                  {header.isPlaceholder ? null : flexRender(
                    header.column.columnDef.header,
                    header.getContext(),
                  )}
                </TableHead>
              ))}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {table.getRowModel().rows.length
            ? table.getRowModel().rows.map((row) => (
              <TableRow
                key={row.id}
                className="group"
                data-state={row.getIsSelected() ? "selected" : undefined}
              >
                {row.getVisibleCells().map((cell) => (
                  <TableCell
                    key={cell.id}
                    className={cell.column.id === "actions"
                      ? "sticky right-0 bg-background group-hover:bg-muted group-data-[state=selected]:bg-muted"
                      : undefined}
                  >
                    {flexRender(
                      cell.column.columnDef.cell,
                      cell.getContext(),
                    )}
                  </TableCell>
                ))}
              </TableRow>
            ))
            : (
              <TableRow>
                <TableCell
                  colSpan={columns.length + 2}
                  className="h-24 text-center text-muted-foreground"
                >
                  {empty}
                </TableCell>
              </TableRow>
            )}
        </TableBody>
      </Table>
    </div>
  );
}
