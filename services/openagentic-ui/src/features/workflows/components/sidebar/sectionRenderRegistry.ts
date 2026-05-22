/**
 * sectionRenderRegistry — re-exports the body-only section renderer
 * from SidebarSectionModal so RailSurfaceModal can render any section
 * inside its own modal chrome.
 *
 * Per user directive 2026-05-14: each rail item gets its own dedicated
 * modal/settings page. RailSurfaceModal owns the modal frame; the
 * existing section bodies (NodesContent / RunsContent / etc. defined
 * inside SidebarSectionModal.tsx) supply the content. This thin
 * re-export module keeps RailSurfaceModal from import-cycling through
 * the 3700-line section file's full surface.
 */

export { renderSectionBody, sectionTitleFor } from './SidebarSectionModal';
