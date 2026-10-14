# お絵描き保存ワールド

DcPenで描いた空間ストロークを作品ライブラリへ登録し、白紙の5つのキャンバスへ選択呼出・軌跡再生できる独立テストワールドです。

背景には、このワールド専用に画像生成した2:1のポップアート・パノラマを内向きスカイドームとして表示します。単色背景は画像読込中のフォールバックとして残しています。

## 体験の流れ

1. 入室時、5つのキャンバスは保存作品を表示せず白紙で開始
2. 各キャンバス下部のコンパクト一覧で、面ごとに別々の呼出候補を選ぶ
3. 任意のキャンバスへ全体を「呼出」、または描いた順に「軌跡を再生」
4. 「呼出作品を消す」で展示だけ白紙に戻す（保存は残る）
5. 右側のP1〜P10のDcPenラックからペンを取り、トリガー2連打のクイックリングで線・リボン・筆・消しゴム・15色を選んで描く
6. 「新しい作品として登録」で作品名を入力し、作者名・ペン番号・線を保存
7. 背面の保存作品一覧は、全作品の確認・更新・作者本人による削除に使用

新規作品は `pen.gallery.artwork.<UUID>.v2` の1作品1キーで保存します。旧 `pen.gallery.canvas.1.v1`〜`.5.v1` も一覧へ読み込みます。登録操作1回につき1回だけ書き込み、各作品は90KiB以下へ収めます。保存内容は公開読み取り可能です。ゲストは描画・閲覧・呼出・再生のみ行えます。

DcPenの生線と保存作品の表示は別レイヤーです。「呼出作品を消す」は保存表示だけを消します。DcPenの生線はラックに備わる消しゴム、ペン別Clear、またはClear Mineを使い、いずれも操作した本人の線だけを消します。

保存時はキャンバスごとに「自分の線」「選択ペン」「キャンバス内全部」を切り替えられます。選択ペンでは、同じ物理ペンを受け渡して描いた複数ユーザーの作者名を作品へ残します。

## DcPen連携境界

原作者 [toming](https://github.com/tomingtoming/dcpen) さんの `xrift-dcpen@0.1.4` を土台にした
[マルチプレイ描画実験Fork](https://github.com/toM7x7/dcpen)（`0.5.0-quick-ring.1` / commit `e817ef8`）を使用しています。

ペンを持ったままトリガーを2連打するとペン中心のクイックリングが開きます。ペン先を選択肢へ1秒近づけて `LINE / RIBBON / FUDE / 消しゴム / 色` を確定します。ラックはP1〜P10の10本で、色を変えても物理ペン番号が軸とラックに残ります。RIBBONとFUDEはゆっくり動かすと太く、速く動かすと細くなり、FUDEは線の入りと抜きも細くなります。
従来のLINEを既定のまま残し、RIBBONではコントローラー姿勢とトリガー筆圧を帯メッシュへ反映します。
入力機器から筆圧を取得できない場合は、描画速度から幅を補完します。

画廊は `${syncId}:strokes` のインスタンス状態を [dcpen.ts](./src/integrations/dcpen.ts) だけで参照し、
通常線／リボンの種別・幅・姿勢・筆圧・時刻を作品保存と軌跡再生へ引き継ぎます。

## 開発

```bash
npm install
npm run test
npm run typecheck
npm run build
npm run dev
```

このワールドのリポジトリは https://github.com/toM7x7/toMoXRift_oekakihozon-world です。
DcPen ForkはGitHubのコミット `e817ef80346ccc13901e81cdef40ac0cf1038f8f` に固定し、別のPCでもローカルForkなしで `npm ci` できます。
既存ワールドの更新先IDは `d0f77a41-4259-433f-97c4-96f2843e34e1` です。ローカルの `.xrift/world.json` はGitへ含めません。

ローカルのWorld Storageは開発用インメモリ実装です。本番の永続性、別インスタンスからの呼び出し、ゲスト制約はXRift上で確認します。

## XRift登録

- World ID: `d0f77a41-4259-433f-97c4-96f2843e34e1`
- 初回アップロード: version 1 / `ACTIVE` / 限定公開
- 最新アップロード: version 13 / `ACTIVE` / 公開
- 現行DcPen: `xrift-dcpen@0.5.0-quick-ring.1`（P1〜P10＋1秒ホバー確定クイックリング）
- アップロード日時: 2026-08-28

## クレジット

- [DcPen](https://github.com/tomingtoming/dcpen) by toming — QvPen by ureishiへのリスペクトから生まれたXRift向け実装
- [DcPen Brush Experiment Fork](https://github.com/toM7x7/dcpen) by toM7x7 — このワールド向けLINE/RIBBON比較実験
- [xrift-grab](https://github.com/tomingtoming/xrift-grab) by toming
- [QvPen](https://github.com/ureishi/QvPen) by ureishi

DcPenとxrift-grabはMIT Licenseです。詳細は [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md) を参照してください。

生成スカイボックスの制作メモと最終プロンプトは [POP_ART_SKYBOX.md](./docs/POP_ART_SKYBOX.md) に記録しています。

今後の検討事項は [ROADMAP.md](./ROADMAP.md) に分離しています。
