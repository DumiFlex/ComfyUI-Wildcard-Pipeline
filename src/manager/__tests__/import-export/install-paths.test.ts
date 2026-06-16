import { describe, it, expect } from "vitest";
import { decideInstallPath } from "@/manager/import-export/install";

import type { SchemaCatalogEntry } from "@/api/types";

const catalogAdditive: SchemaCatalogEntry[] = [
  { version: 1, is_breaking_from_previous: false, min_consumer_engine_version: null, notes: "", created_at: null },
  { version: 2, is_breaking_from_previous: false, min_consumer_engine_version: null, notes: "", created_at: null },
];
const catalogBreaking: SchemaCatalogEntry[] = [
  { version: 1, is_breaking_from_previous: false, min_consumer_engine_version: null, notes: "", created_at: null },
  { version: 2, is_breaking_from_previous: true, min_consumer_engine_version: null, notes: "", created_at: null },
];

describe("install path decision", () => {
  it("Path 3a: payload at CURRENT -> 'install_direct'", () => {
    const out = decideInstallPath({ payloadVersion: 1, currentVersion: 1, catalog: catalogAdditive });
    expect(out.path).toBe("install_direct");
  });

  it("Path 3a: payload below CURRENT -> 'install_with_chain'", () => {
    const out = decideInstallPath({ payloadVersion: 1, currentVersion: 2, catalog: catalogAdditive });
    expect(out.path).toBe("install_with_chain");
  });

  it("Path 3b: payload above CURRENT, all-additive -> 'install_tolerant'", () => {
    const out = decideInstallPath({ payloadVersion: 2, currentVersion: 1, catalog: catalogAdditive });
    expect(out.path).toBe("install_tolerant");
  });

  it("Path 3b: payload above CURRENT, any-breaking-in-interval -> 'refuse'", () => {
    const out = decideInstallPath({ payloadVersion: 2, currentVersion: 1, catalog: catalogBreaking });
    expect(out.path).toBe("refuse");
  });

  it("AND-fold catches breaking step in middle of interval", () => {
    const catalog: SchemaCatalogEntry[] = [
      { version: 1, is_breaking_from_previous: false, min_consumer_engine_version: null, notes: "", created_at: null },
      { version: 2, is_breaking_from_previous: false, min_consumer_engine_version: null, notes: "", created_at: null },
      { version: 3, is_breaking_from_previous: true, min_consumer_engine_version: null, notes: "", created_at: null },
      { version: 4, is_breaking_from_previous: false, min_consumer_engine_version: null, notes: "", created_at: null },
    ];
    // CURRENT=2, payload=4: interval is (2, 4] = {3, 4}. v3 is breaking -> refuse.
    const out = decideInstallPath({ payloadVersion: 4, currentVersion: 2, catalog });
    expect(out.path).toBe("refuse");
  });
});
