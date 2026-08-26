import { describe, expect, it } from "vitest";
import {
  buildTable,
  cellText,
  emptyView,
  explanations,
  filterRows,
  nextSort,
  sortRows,
  type TableColumn,
} from "../../src/ui/tableModel";

interface Machine {
  readonly name: string;
  readonly price: number;
  readonly upkeep: number;
  readonly armour: number;
}

const MACHINES: readonly Machine[] = [
  { name: "Placeholder Ironclad", price: 2_900_000, upkeep: 6_200, armour: 0.95 },
  { name: "Placeholder Sentinel", price: 900_000, upkeep: 4_100, armour: 0.6 },
  { name: "Placeholder Racer", price: 7_800_000, upkeep: 11_400, armour: 0.3 },
];

const COLUMNS: readonly TableColumn<Machine>[] = [
  { id: "name", label: "Name", value: (row) => row.name, explain: "What it is called." },
  {
    id: "price",
    label: "Price",
    value: (row) => row.price,
    text: (row) => row.price.toLocaleString("en-GB"),
    higherIsBetter: false,
    explain: "What the yard is asking. Lower is better.",
  },
  {
    id: "upkeep",
    label: "Upkeep",
    value: (row) => row.upkeep,
    higherIsBetter: false,
    explain: "What it costs a day to keep. Lower is better.",
  },
  { id: "armour", label: "Armour", value: (row) => row.armour, explain: "How much it stops." },
];

describe("sorting a management table", () => {
  it("sorts numbers as numbers rather than as text", () => {
    // 900,000 must come before 2,900,000, which text sorting would get wrong.
    const sorted = sortRows(COLUMNS, MACHINES, "price", "ascending");
    expect(sorted.map((row) => row.price)).toEqual([900_000, 2_900_000, 7_800_000]);
  });

  it("reverses on request", () => {
    const sorted = sortRows(COLUMNS, MACHINES, "price", "descending");
    expect(sorted[0]!.price).toBe(7_800_000);
  });

  it("sorts text alphabetically", () => {
    const sorted = sortRows(COLUMNS, MACHINES, "name", "ascending");
    expect(sorted[0]!.name).toBe("Placeholder Ironclad");
  });

  it("leaves the order alone when nothing is sorted by", () => {
    expect(sortRows(COLUMNS, MACHINES, null, "ascending")).toEqual([...MACHINES]);
  });

  it("cycles a header click through ascending, descending and back", () => {
    const view = emptyView(MACHINES);
    const first = nextSort(view, "price");
    expect(first).toEqual({ sortColumnId: "price", direction: "ascending" });
    const second = nextSort({ ...view, ...first }, "price");
    expect(second.direction).toBe("descending");
    const third = nextSort({ ...view, ...second }, "price");
    expect(third.direction).toBe("ascending");
  });

  it("starts a new column ascending rather than keeping the old direction", () => {
    const view = { ...emptyView(MACHINES), sortColumnId: "price", direction: "descending" as const };
    expect(nextSort(view, "armour")).toEqual({ sortColumnId: "armour", direction: "ascending" });
  });
});

describe("filtering a management table", () => {
  it("matches what a cell says rather than the raw value", () => {
    // The price cell says "2,900,000", so that is what a player searches for.
    const view = { ...emptyView(MACHINES), query: "2,900,000" };
    expect(filterRows(COLUMNS, view)).toHaveLength(1);
  });

  it("matches case insensitively across every column", () => {
    expect(filterRows(COLUMNS, { ...emptyView(MACHINES), query: "racer" })).toHaveLength(1);
  });

  it("shows everything when nothing is typed", () => {
    expect(filterRows(COLUMNS, emptyView(MACHINES))).toHaveLength(MACHINES.length);
  });

  it("shows nothing rather than everything when nothing matches", () => {
    expect(filterRows(COLUMNS, { ...emptyView(MACHINES), query: "nonesuch" })).toHaveLength(0);
  });

  it("applies a numeric floor", () => {
    const view = { ...emptyView(MACHINES), minimums: { armour: 0.5 } };
    expect(filterRows(COLUMNS, view).map((row) => row.name)).toEqual([
      "Placeholder Ironclad",
      "Placeholder Sentinel",
    ]);
  });

  it("combines a query and a floor rather than choosing one", () => {
    const view = { ...emptyView(MACHINES), query: "placeholder", minimums: { armour: 0.9 } };
    expect(filterRows(COLUMNS, view)).toHaveLength(1);
  });

  it("ignores a floor on a column that does not exist", () => {
    const view = { ...emptyView(MACHINES), minimums: { nothing: 5 } };
    expect(filterRows(COLUMNS, view)).toHaveLength(MACHINES.length);
  });
});

describe("comparing against what you already have", () => {
  it("says nothing about comparison when nothing is being compared", () => {
    const table = buildTable(COLUMNS, emptyView(MACHINES));
    for (const row of table) {
      for (const cell of row.cells) expect(cell.comparison).toBeNull();
    }
  });

  it("knows that a lower price is better and a higher armour is better", () => {
    const owned = MACHINES[0]!;
    const table = buildTable(COLUMNS, emptyView(MACHINES), owned);
    const cheaper = table.find((entry) => entry.row.name === "Placeholder Sentinel")!;
    expect(cheaper.cells.find((cell) => cell.columnId === "price")?.comparison).toBe("better");
    expect(cheaper.cells.find((cell) => cell.columnId === "armour")?.comparison).toBe("worse");

    const dearer = table.find((entry) => entry.row.name === "Placeholder Racer")!;
    expect(dearer.cells.find((cell) => cell.columnId === "price")?.comparison).toBe("worse");
  });

  it("compares the row against itself as the same", () => {
    const owned = MACHINES[0]!;
    const table = buildTable(COLUMNS, emptyView(MACHINES), owned);
    const self = table.find((entry) => entry.row === owned)!;
    for (const cell of self.cells) expect(cell.comparison).toBeNull();
  });

  it("filters and sorts before it compares", () => {
    const view = {
      ...emptyView(MACHINES),
      query: "placeholder",
      sortColumnId: "upkeep",
      direction: "descending" as const,
    };
    const table = buildTable(COLUMNS, view, MACHINES[1]!);
    expect(table[0]!.row.name).toBe("Placeholder Racer");
    expect(table[0]!.cells.find((cell) => cell.columnId === "upkeep")?.comparison).toBe("worse");
  });
});

describe("every column explains itself", () => {
  it("has a meaning for the tooltip, never a bare header", () => {
    const meanings = explanations(COLUMNS);
    for (const column of COLUMNS) {
      expect(meanings[column.id], column.id).toBeDefined();
      expect(meanings[column.id]!.length, column.id).toBeGreaterThan(10);
    }
  });

  it("falls back to the value when a column has no text of its own", () => {
    expect(cellText(COLUMNS[3]!, MACHINES[0]!)).toBe("0.95");
    expect(cellText(COLUMNS[1]!, MACHINES[0]!)).toBe("2,900,000");
  });
});
