/**
 * Shared types for the Breadcrumb component.
 *
 * Extracted to a dedicated .ts file so consumers (EditorFrame +
 * editors) can import the type without going through Vue's SFC module
 * shim, which some IDEs don't fully resolve for named exports.
 */
export interface BreadcrumbItem {
  /** When provided AND segment is not the last, renders as a router link. */
  to?: string;
  label: string;
}
