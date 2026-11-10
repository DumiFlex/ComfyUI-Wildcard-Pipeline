// Library 6: keep a big library tidy. Dashboard at a glance; All items with search; a "Fantasy"
// category made on Categories; Role, Setting and Outfit selected in All items and given the category
// and a "characters" tag in bulk; Role starred; Filters by category, favourites, tags and content
// rating.
import { StepError } from "watchwright";
import { tutorial, type Tutor } from "../tutorial.js";

const ROLE = "808878ba";

async function isFavourite(t: Tutor): Promise<boolean> {
  const r = await t.h.api(`/wp/api/modules/${ROLE}`);
  const row = (r.json?.data ?? r.json) as { is_favorite?: unknown } | undefined;
  return !!row?.is_favorite;
}

/** Off camera: puts Role's star on or off (the API only toggles it). */
async function setFavourite(t: Tutor, on: boolean): Promise<void> {
  if ((await isFavourite(t)) !== on) await t.h.api(`/wp/api/modules/${ROLE}/favorite`, { method: "POST" });
}

tutorial(
  "L06",
  {
    title: "Keep a big library tidy",
    description: "Find anything in a big library: the dashboard, All items, search and filters, categories, tags, favourites and the content rating.",
    learn: "Dashboard, All items, search, bulk category and tags, favourites, filters and SFW / 18+.",
  },
  async (t) => {
    const page = t.page;

    await t.h.step("The dashboard", async () => {
      // Earlier videos in the run add items; this one shows the library as it is after the import.
      await t.tidyLibrary();
      await t.go("/wp/dashboard");
      await t.say("The dashboard is the library at a glance: how many of each kind, what you changed last, and what needs a look.");
      await t.beat(1500);
      await t.waitVoice();
    });

    await t.h.step("A category", async () => {
      await t.go("/wp/categories");
      await t.say("Categories group items, like folders. Make one called Fantasy.");
      await t.fill(page.locator('[data-test="new-cat-name"]'), "Fantasy", { cps: 14 });
      await t.click(page.locator('[data-test="add-category-btn"]'));
      await t.beat(1000);
      await t.waitVoice();
    });

    await t.h.step("All items, in bulk", async () => {
      await t.go("/wp/all");
      await t.say("All items lists every kind in one table. Tick a few, and the bar above acts on all of them at once.");
      for (const id of ["808878ba", "aa76ada8", "195238e2"]) {
        await t.click(page.locator(`[data-test="row-select-${id}"]`));
        await t.beat(300);
      }
      await t.callout("bar", page.locator('[data-test="bulk-bar"]'), "Favourite, tag, category, delete", 4);
      await t.waitVoice();
      await t.uncallout("bar");
      await t.say("Set category: Fantasy.");
      await t.click(page.locator('[data-test="bulk-set-category-open"]'));
      await t.beat(700);
      const dlg = page.getByRole("dialog").last();
      await t.click(dlg.locator('[data-test="select-trigger"]'));
      await t.beat(500);
      await t.click(page.getByRole("option", { name: /Fantasy/ }).first());
      await t.beat(400);
      await t.click(page.locator('[data-test="bulk-set-category-submit"]'));
      await t.beat(1000);
      await t.say("And a tag, characters. Tags cut across categories, so one item can carry several.");
      await t.click(page.locator('[data-test="bulk-tag-add-open"]'));
      await t.beat(600);
      await t.fill(page.locator('[data-test="bulk-tag-input"]'), "characters", { cps: 14 });
      await t.click(page.locator('[data-test="bulk-tag-submit"]'));
      await t.beat(1000);
      await t.click(page.locator('[data-test="bulk-clear"]'));
      await t.beat(500);
      await t.waitVoice();
    });

    await t.h.step("Favourites and search", async () => {
      // Off camera: a star left from an earlier take would make the click below take it off.
      await setFavourite(t, false);
      await t.say("The search box finds items by name, id or tag. Type role.");
      const search = page.getByPlaceholder(/Search by name/);
      await t.fill(search, "role", { cps: 12 });
      await t.beat(1000);
      await t.waitVoice();
      // Role is on the second page of the full table; found, its row is at the top.
      await t.say("The star marks a favourite. Star Role.");
      const role = page.locator("tr", { has: page.locator(`[data-test="row-select-${ROLE}"]`) });
      await t.click(role.getByRole("button", { name: /favorite/i }).first());
      await t.beat(700);
      if (!(await isFavourite(t))) throw new StepError("Role didn't get its star.");
      await t.waitVoice();
      await t.fill(search, "", { cps: 12 });
      await t.beat(500);
    });

    await t.h.step("Filters", async () => {
      await t.say("Filters narrow the table by kind, category, favourites, tags, and content rating: SFW or 18+. Each item's editor sets its rating.", "Filters narrow the table by kind, category, favourites, tags, and content rating: safe for work, or eighteen plus. Each item's editor sets its rating.");
      await t.click(page.getByRole("button", { name: "Filters" }));
      await t.beat(700);
      await t.click(page.getByRole("checkbox", { name: /Favorites only/ }).first());
      await t.beat(900);
      await t.callout("tbl", page.locator("table").first(), "Only the favourites", 4);
      await t.waitVoice();
      await t.uncallout("tbl");
      await t.click(page.getByRole("checkbox", { name: /Favorites only/ }).first());
      await t.beat(700);
    });

    await t.h.step("Outro", async () => {
      await t.say("Categories and tags sort it, the star and search find it, and filters narrow it down. That's the library track.");
      await t.waitVoice();
      // Off camera: the next video starts without the star.
      await setFavourite(t, false);
    });
  },
);
