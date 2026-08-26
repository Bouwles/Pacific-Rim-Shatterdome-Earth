/**
 * Sorting, filtering and comparison for the management panels.
 *
 * One implementation the panels share, rather than each board inventing its
 * own idea of what a column is. A panel supplies its columns and its rows; this
 * decides the order, what survives a filter, and what two rows differ by.
 *
 * Pure. No DOM, no Babylon. That is what lets "sorted by upkeep, descending,
 * showing only what is affordable" be a unit test rather than something checked
 * by looking at a screen.
 */

/** How a column is read and compared. */
export interface TableColumn<Row> {
  readonly id: string;
  readonly label: string;
  /** The value used for sorting and comparison. */
  readonly value: (row: Row) => number | string;
  /** What the cell says. Defaults to the value. */
  readonly text?: (row: Row) => string;
  /** True when a larger number is a better one, for the comparison arrows. */
  readonly higherIsBetter?: boolean;
  /** What the column means, for the tooltip. */
  readonly explain: string;
}

export type SortDirection = "ascending" | "descending";

export interface TableView<Row> {
  readonly rows: readonly Row[];
  readonly sortColumnId: string | null;
  readonly direction: SortDirection;
  /** Free text the player typed. Matched against every column's text. */
  readonly query: string;
  /** Column id to numeric floor, for "only show me things above this". */
  readonly minimums: Readonly<Record<string, number>>;
}

export function emptyView<Row>(rows: readonly Row[]): TableView<Row> {
  return { rows, sortColumnId: null, direction: "ascending", query: "", minimums: {} };
}

/** What one cell shows, and how it compares to the row being compared against. */
export interface TableCell {
  readonly columnId: string;
  readonly text: string;
  /**
   * How this row compares on this column: better, worse, or the same.
   *
   * Null when nothing is being compared against, so a panel showing one thing
   * does not imply a comparison that is not happening.
   */
  readonly comparison: "better" | "worse" | "same" | null;
}

export interface TableRowView<Row> {
  readonly row: Row;
  readonly cells: readonly TableCell[];
}

/** The text a column shows for a row, falling back to the raw value. */
export function cellText<Row>(column: TableColumn<Row>, row: Row): string {
  if (column.text) return column.text(row);
  const value = column.value(row);
  return typeof value === "number" ? String(value) : value;
}

/**
 * Applies the filter.
 *
 * The free-text query matches against what a cell actually says rather than
 * against the underlying value, because a player searching for "Mk-4" is
 * reading the screen, not the data model.
 */
export function filterRows<Row>(columns: readonly TableColumn<Row>[], view: TableView<Row>): readonly Row[] {
  const query = view.query.trim().toLowerCase();
  return view.rows.filter((row) => {
    if (query.length > 0) {
      const haystack = columns.map((column) => cellText(column, row).toLowerCase()).join(" ");
      if (!haystack.includes(query)) return false;
    }
    for (const [columnId, minimum] of Object.entries(view.minimums)) {
      const column = columns.find((entry) => entry.id === columnId);
      if (!column) continue;
      const value = column.value(row);
      if (typeof value !== "number" || value < minimum) return false;
    }
    return true;
  });
}

/**
 * Applies the sort.
 *
 * Stable, and numbers compare as numbers rather than as text: sorting a price
 * column must not put 1,000,000 before 900,000 because "1" sorts before "9".
 */
export function sortRows<Row>(
  columns: readonly TableColumn<Row>[],
  rows: readonly Row[],
  sortColumnId: string | null,
  direction: SortDirection,
): readonly Row[] {
  const column = columns.find((entry) => entry.id === sortColumnId);
  if (!column) return [...rows];
  const sign = direction === "ascending" ? 1 : -1;
  return [...rows].sort((first, second) => {
    const a = column.value(first);
    const b = column.value(second);
    if (typeof a === "number" && typeof b === "number") return (a - b) * sign;
    return String(a).localeCompare(String(b)) * sign;
  });
}

/**
 * The whole view: filtered, sorted, and compared against one row.
 *
 * Comparison is against a row rather than against an average, because the
 * question a player is actually asking is "is this better than the one I have".
 */
export function buildTable<Row>(
  columns: readonly TableColumn<Row>[],
  view: TableView<Row>,
  compareTo?: Row,
): readonly TableRowView<Row>[] {
  const filtered = filterRows(columns, view);
  const sorted = sortRows(columns, filtered, view.sortColumnId, view.direction);

  return sorted.map((row) => ({
    row,
    cells: columns.map((column) => ({
      columnId: column.id,
      text: cellText(column, row),
      comparison: compareTo === undefined || compareTo === row ? null : compare(column, row, compareTo),
    })),
  }));
}

function compare<Row>(column: TableColumn<Row>, row: Row, against: Row): "better" | "worse" | "same" {
  const a = column.value(row);
  const b = column.value(against);
  if (typeof a !== "number" || typeof b !== "number") {
    return String(a) === String(b) ? "same" : "better";
  }
  if (a === b) return "same";
  // A column where lower is better, such as a price or an upkeep, inverts.
  const higherIsBetter = column.higherIsBetter ?? true;
  const rowIsHigher = a > b;
  return rowIsHigher === higherIsBetter ? "better" : "worse";
}

/** Turning a header click into the next sort state. */
export function nextSort<Row>(
  view: TableView<Row>,
  columnId: string,
): { readonly sortColumnId: string; readonly direction: SortDirection } {
  if (view.sortColumnId !== columnId) return { sortColumnId: columnId, direction: "ascending" };
  return {
    sortColumnId: columnId,
    direction: view.direction === "ascending" ? "descending" : "ascending",
  };
}

/** Every column's meaning, for the tooltips. Never a bare header. */
export function explanations<Row>(columns: readonly TableColumn<Row>[]): Readonly<Record<string, string>> {
  return Object.fromEntries(columns.map((column) => [column.id, column.explain]));
}
