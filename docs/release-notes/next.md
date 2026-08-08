### Firefox: the editor no longer dies when you insert a nested reference

Picking a wildcard from the `@` autocomplete could take down the whole editor —
the field stopped accepting text, Backspace did nothing, and Save and Cancel
stopped responding until the page was reloaded. Select-all then cut inside an
option value did the same thing.

Both were the same cause. Firefox removes the empty text nodes that Vue uses to
mark where each chip and text run begins and ends, and once they are gone any
edit that adds or removes a chip runs off the end of the field's contents.
Chromium keeps those markers, which is why this only ever happened on Firefox
and never reproduced during development.

The editor now notices when those markers have been removed and rebuilds the
field instead of tripping over them. This affects every rich text field —
option values, combine templates, derivation rules and injector bindings, on
the canvas and in the manager alike.

### Your library is protected against version mismatches

If a database has been through migrations that this build does not recognise —
after downgrading, hand-installing an older copy, or switching versions in
ComfyUI Manager — Wildcard Pipeline now stops with a clear message instead of
quietly reading a library it does not understand. Previously it carried on, and
every later edit was written through assumptions that no longer held.

### Release archives now include the interface translations

The release zip was missing `locales/`, so node names, descriptions and setting
labels fell back to raw identifiers for anyone installing from it. Installs
from ComfyUI Manager and the Comfy Registry were unaffected.
