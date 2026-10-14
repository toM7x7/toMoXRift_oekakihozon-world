import type { Stroke } from 'xrift-dcpen'

/**
 * DcPen compatibility boundary.
 *
 * DcPen publicly documents `syncId`, while the `:strokes` suffix and stroke-id
 * layout are implementation details in 0.1.4. Keep that knowledge isolated here
 * so a future official export API can replace this adapter without touching the
 * gallery UI or persistence model.
 */
export const DCPEN_VERSION = '0.5.0-quick-ring.1'
export const DCPEN_SYNC_ID = 'pen-memory-gallery-dcpen-v1'
export const DCPEN_STROKES_STATE_KEY = `${DCPEN_SYNC_ID}:strokes`

export type DcPenStroke = Stroke
