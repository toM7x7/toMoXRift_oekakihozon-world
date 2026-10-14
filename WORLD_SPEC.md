# お絵描き保存ワールド

- Slug: `pen-memory-gallery`
- Template: `WebXR-JP/xrift-test-world`
- Blueprint: `../../blueprints/pen-memory-gallery.md`

## Experience

明るい32m四方のフラット空間に、19m幅の壁と3m × 2.2mのキャンバスを5枚配置する。入室時は5面とも保存表示を白紙にし、各キャンバス下部のコンパクト一覧で面ごとに別々の作品を選び、呼出・軌跡再生する。スポーン背面の作品アーカイブ卓は保存管理と削除に使う。右側のDcPenラックから描いた線は、新しい作品としてライブラリへ追加する。

背景は `public/pop-art-skybox-v1.png`（1774 × 887、2:1）の生成パノラマを半径120mの内向き球面へ表示する。スカイドーム材質はfogとtone mappingの影響を受けず、XRift本番でscene backgroundが黒くなる場合も常に描画される。

## Persistence

- Live drawing: DcPenの`useInstanceState` / `useInstanceEvent`
- Persistent library: `pen.gallery.artwork.<UUID>.v2`（1作品1キー）
- Legacy read compatibility: `pen.gallery.canvas.1.v1`〜`pen.gallery.canvas.5.v1`
- Record contents: 作品名、登録者、描画参加者一覧、保存対象、保存日時、DcPen syncId、ペン番号、色、キャンバス相対点列
- New records use schema v2 and can capture `mine` / `pen` / `all`; schema v1 remains readable
- Legacy records without a title remain readable and display as `無題`
- One registration equals one World Storage write
- Client-side record limit: 90KiB
- Write cooldown: 5 seconds
- Saved values are publicly readable; guests are read-only
- Canvas display state and playback clock are local/session state and start blank
- Clearing a recalled display never deletes storage; persistent deletion is a separate confirmed author-only UI action
- Author-only deletion is client-side cooperation, not a server-enforced ACL

## Geometry

- Floor mesh/collider: `32 × 0.2 × 32m`, center `y=-0.1`
- Gallery wall mesh/collider: `19 × 4.6 × 0.2m`, center `[0, 2.3, -8.3]`
- Canvas centers: `x=-7.2, -3.6, 0, 3.6, 7.2`, `y=2.35`, front near `z=-8.04`
- Capture depth: `z=-8.25`〜`-7.05`
- Spawn: `[0, 0.05, 6]`, `yaw=0`
- Artwork archive console: centered near `[0, 0, 14.4]`, facing toward spawn
- World guide panel: `[-10.2, 1.55, -0.8]`, facing inward from the left side
- DcPen attribution panel: `[10.2, 1.35, -0.8]`, facing inward from the right side
- Per-canvas compact selectors: below the four action buttons at `y=0.18`, with independent previous/next selection
- Per-canvas save-scope selector: `y=1.42`, cycles `自分の線` → `選択ペン` → `キャンバス内全部`
- Persistent bottom status panels: removed to keep the control stack compact
- Pop-art skydome: radius `120m`, BackSide, `fog=false`, `toneMapped=false`, `depthWrite=false`

The visible floor and wall dimensions exactly match their fixed cuboid colliders.

## Compatibility Boundary

The version 13 world links `xrift-dcpen@0.5.0-quick-ring.1` from `../../forks/dcpen` at fork commit `e817ef8`. It shows ten physical pens identified as P1〜P10 and opens a pen-centered quick ring on trigger double-click. A tool or color is confirmed after the pen tip remains over it for 1000ms. The ring selects `LINE / RIBBON / FUDE / ERASE / COLOR`, exposes all 15 legacy colors, and keeps each physical pen's synchronized color independently. RIBBON and FUDE use smoothed movement speed for width; FUDE also tapers stroke entry and exit. The world still reads the version-specific `${syncId}:strokes` state through `src/integrations/dcpen.ts`; review that adapter before upgrading DcPen.

## Acceptance Gates

- Unit tests for library collection, legacy compatibility, multi-author save scopes, author deletion eligibility, trajectory ordering/playback slicing, title normalization, SID parsing, user filtering, bounds segmentation, rounding, byte fitting, and validation
- TypeScript typecheck
- Module Federation production build
- Browser visual check of spawn, Japanese UI, five canvases, and DcPen rack
- Separate physical Quest check for grip, trigger drawing, registration, re-entry, and another instance
- Quick-ring Quest check for double-trigger opening, tool/color dwell selection, P1〜P10 identification, and two-user pen independence
