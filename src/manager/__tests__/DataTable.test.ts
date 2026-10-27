import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import DataTable, { type DataColumn } from "../components/ui/DataTable.vue";

interface Row { id: string; name: string; uses: number | null }
const ROWS: Row[] = [
  { id: "1", name: "pose", uses: 4 },
  { id: "2", name: "Hair", uses: null },
  { id: "3", name: "lighting", uses: 10 },
];
const COLS: DataColumn<Row>[] = [
  { key: "name", label: "Name", sortable: true },
  { key: "uses", label: "Uses", sortable: true, firstDir: "desc", align: "right" },
];


describe("DataTable", () => {
  it("sorts by the column, blanks last, and marks only that column with aria-sort", () => {
    const w = mount(DataTable<Row>, { props: { columns: COLS, rows: ROWS, rowKey: "id", sort: { key: "uses", dir: "desc" } } });
    expect(w.findAll("tbody tr").map((tr) => tr.findAll("td")[0].text())).toEqual(["lighting", "pose", "Hair"]);
    const ths = w.findAll("th");
    expect(ths[0].attributes("aria-sort")).toBeUndefined();
    expect(ths[1].attributes("aria-sort")).toBe("descending");
  });

  it("sorts names without case and reports header clicks", async () => {
    const w = mount(DataTable<Row>, { props: { columns: COLS, rows: ROWS, rowKey: "id", sort: { key: "name", dir: "asc" } } });
    expect(w.findAll("tbody tr").map((tr) => tr.findAll("td")[0].text())).toEqual(["Hair", "lighting", "pose"]);
    await w.findAll("th button")[0].trigger("click");
    await w.findAll("th button")[1].trigger("click");
    expect(w.emitted("update:sort")).toEqual([[{ key: "name", dir: "desc" }], [{ key: "uses", dir: "desc" }]]);
  });

  it("leaves the order alone with manual-sort", () => {
    const w = mount(DataTable<Row>, { props: { columns: COLS, rows: ROWS, rowKey: "id", sort: { key: "name", dir: "asc" }, manualSort: true } });
    expect(w.findAll("tbody tr").map((tr) => tr.findAll("td")[0].text())).toEqual(["pose", "Hair", "lighting"]);
  });

  it("selects rows and all rows, with a mixed header box", async () => {
    const w = mount(DataTable<Row>, { props: { columns: COLS, rows: ROWS, rowKey: "id", selectable: true, selected: ["2"] } });
    const head = w.find("thead [role=checkbox]");
    expect(head.attributes("aria-checked")).toBe("mixed");
    expect(w.findAll("tbody tr")[1].attributes("aria-selected")).toBe("true");
    await head.trigger("click");
    expect(w.emitted("update:selected")?.[0]?.[0]).toEqual(["2", "1", "3"]);
    await w.findAll("tbody [role=checkbox]")[1].trigger("click");
    expect(w.emitted("update:selected")?.[1]).toEqual([[]]);
  });

  it("draws loading rows, then the empty row", async () => {
    const w = mount(DataTable<Row>, { props: { columns: COLS, rows: [], rowKey: "id", loading: true, loadingRows: 2 } });
    expect(w.findAll("tbody tr.wp-row-skel")).toHaveLength(2);
    expect(w.find("table").attributes("aria-busy")).toBe("true");
    await w.setProps({ loading: false, emptyText: "No tags yet." });
    expect(w.find("tbody").text()).toBe("No tags yet.");
  });

  it("fills cells from #cell-<key> slots and adds row attributes", () => {
    const w = mount(DataTable<Row>, {
      props: { columns: COLS, rows: ROWS.slice(0, 1), rowKey: (r: Row) => `k${r.id}`, rowAttrs: (r: Row) => ({ "data-test": `row-${r.name}` }) },
      slots: { "cell-name": "<b>{{ params.row.name.toUpperCase() }}</b>" },
    });
    expect(w.find("[data-test=row-pose] b").text()).toBe("POSE");
  });
});
