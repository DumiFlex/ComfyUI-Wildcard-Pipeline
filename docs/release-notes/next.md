### Fixes

- **Cutting an already-empty field no longer wipes your clipboard.** Cut an option's text, press Ctrl+A Ctrl+X again on the now-empty field, and the text you meant to paste was gone: the editor let the browser cut an invisible caret marker, which replaced what was on the clipboard. The second cut now leaves the clipboard alone, and a paste never writes that invisible character into a value.
