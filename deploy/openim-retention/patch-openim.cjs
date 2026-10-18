'use strict'
// Apply only to a disposable, pinned OpenIM source checkout, never a running
// container or Go module cache. This patch does NOT enable the private listener.
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { execFileSync } = require('node:child_process')
const hashes = {
  'internal/rpc/msg/server.go': '1098705e1e5f126c96dab037905d544d93de2f8f448cb09b4c877d59fbf27054',
  'internal/rpc/msg/as_read.go': 'a2d1fb4b9dce528b7d47d0ae8614e422f3865d5c5ab24944e2c1e48ff7881396',
  'pkg/common/storage/controller/msg.go': '08959f31cf71de1ecfb19e059dd262881f4acbf3cdfa63cfaac74323200899ce',
  'pkg/common/storage/database/mgo/seq_conversation.go': 'ea3e0bb5d69e8607f686a5eb1701132882962354eb9eb9e6de67608485c3329c',
  'pkg/common/storage/database/mgo/msg.go': 'f0111b6591ad09cd5f8bb2555a69e3c7abfb659371af2f2a165f16d36a2330c8',
}
function once(source, from, to) {
  if (source.split(from).length !== 2) throw new Error('Pinned patch anchor changed')
  return source.replace(from, to)
}
function transform(name, source) {
  const digest = crypto.createHash('sha256').update(source).digest('hex')
  if (digest !== hashes[name]) throw new Error(`Pinned OpenIM v3.8.3-patch.15 required: ${name}`)
  let s = source.toString('utf8')
  if (name.endsWith('/server.go')) {
    s = once(s, '\tmsg.RegisterMsgServer(server, s)', '\tif err := startIMAppRetention(ctx, s, mgocli.GetDB()); err != nil { return err }\n\tmsg.RegisterMsgServer(server, s)')
  } else if (name.endsWith('/as_read.go')) {
    s = once(s, '\treturn resp, nil', '\tif err := m.clampIMAppRetentionRead(ctx, resp); err != nil { return nil, err }\n\treturn resp, nil')
  } else if (name.endsWith('/controller/msg.go')) {
    s = once(s, '\tvar msgs []*model.MsgInfoModel\n\tif v, ok := cache[quoteMsg.QuoteMessage.Seq]; ok {', `\t// A retention boundary expires the source, not the embedded quote copy.
\t// Do not reinterpret a purged source as a user revoke.
\tif strings.HasPrefix(conversationID, "sg_") && quoteMsg.QuoteMessage.Seq > 0 {
\t\tminimum, err := db.seqConversation.GetMinSeq(ctx, conversationID)
\t\tif err != nil || quoteMsg.QuoteMessage.Seq < minimum { return }
\t}
\tvar msgs []*model.MsgInfoModel
\tif v, ok := cache[quoteMsg.QuoteMessage.Seq]; ok {`)
    s = once(s, '\t\ttmp := []*model.MsgInfoModel{msg}', `\t\tminSeq, err := db.seqConversation.GetMinSeq(ctx, conversationID)
\t\tif err != nil { return nil, err }
\t\tif msg == nil || msg.Msg == nil || msg.Msg.Seq < minSeq { continue }
\t\ttmp := []*model.MsgInfoModel{msg}`)
    s = once(s, '\t\tdocID := db.msgTable.GetDocID(conversationID, seq)\n\t\tmsgs, err := db.msgDocDatabase.FindOneByDocID(ctx, docID)', `\t\tminimum, err := db.seqConversation.GetMinSeq(ctx, conversationID)
\t\tif err != nil { return nil, err }
\t\tif seq < minimum { continue }
\t\tdocID := db.msgTable.GetDocID(conversationID, seq)
\t\tmsgs, err := db.msgDocDatabase.FindOneByDocID(ctx, docID)`)
    s = once(s, '\t\ttotalMsgs[conversationID] = convert.MsgDB2Pb(msgs.Msg[index].Msg)', `\t\tif index < 0 || index >= int64(len(msgs.Msg)) || msgs.Msg[index] == nil || msgs.Msg[index].Msg == nil { continue }
\t\ttotalMsgs[conversationID] = convert.MsgDB2Pb(msgs.Msg[index].Msg)`)
  } else if (name.endsWith('/mgo/msg.go')) {
    s = once(s, '\treturn mongoutil.Aggregate[searchMessageIndex](ctx, m.coll, pipeline)', '\treturn mongoutil.Aggregate[searchMessageIndex](ctx, m.coll, imAppRetentionSearchPipeline(pipeline))')
    s = once(s, '\treturn mongoutil.UpdateOneResult(ctx, m.coll, filter, update)\n}\n\nfunc (m *MsgMgo) PushUnique', '\treturn m.imAppRetentionGuardedWrite(ctx, docID, index, filter, update)\n}\n\nfunc (m *MsgMgo) PushUnique')
    s = once(s, '\treturn mongoutil.UpdateOneResult(ctx, m.coll, filter, update)\n}', '\treturn m.imAppRetentionGuardedWrite(ctx, docID, index, filter, update)\n}')
    s = once(s, '\treturn mongoutil.DeleteOne(ctx, m.coll, bson.M{"doc_id": docID})', '\treturn m.imAppRetentionDeleteDoc(ctx, docID)')
  } else {
    // Upstream Malloc resets min_seq on every range reservation. That would
    // resurrect expired history after Redis loss. Never reset an existing bound.
    s = once(s, '"$set": map[string]any{"min_seq": int64(0)}', '"$setOnInsert": map[string]any{"min_seq": int64(0)}')
    s = once(s, 'return s.setSeq(ctx, conversationID, seq, "min_seq")', `if seq < 0 { return errors.New("invalid minimum seq") }
\t_, err := s.coll.UpdateOne(ctx, bson.M{"conversation_id": conversationID}, bson.M{
\t\t"$max": bson.M{"min_seq": seq}, "$setOnInsert": bson.M{"conversation_id": conversationID, "max_seq": int64(0)},
\t}, options.Update().SetUpsert(true))
\treturn err`)
  }
  return s
}
function apply(root) {
  root = fs.realpathSync(root)
  if (/\/pkg\/mod\//i.test(root.replaceAll('\\', '/'))) throw new Error('Refusing Go module cache')
  const changes = Object.keys(hashes).map(name => [path.join(root, name), transform(name, fs.readFileSync(path.join(root, name)))])
  const backend = path.resolve(__dirname, '../../IM-APP-server/internal/media')
  for (const name of ['retention.go', 'retention_visibility.go', 'retention_test.go', 'retention_visibility_test.go', 'retention_compact_test.go']) {
    const target = path.join(root, 'internal/imappretention', name)
    if (fs.existsSync(target)) throw new Error('Requires a fresh checkout')
    changes.push([target, fs.readFileSync(path.join(backend, name), 'utf8').replace('package media', 'package imappretention')])
  }
  for (const [template, dest] of [
    ['bridge.go.in', 'internal/rpc/msg/im_app_retention.go'],
    ['bridge_test.go.in', 'internal/rpc/msg/im_app_retention_test.go'],
    ['controller.go.in', 'pkg/common/storage/controller/im_app_retention.go'],
    ['controller_test.go.in', 'pkg/common/storage/controller/im_app_retention_test.go'],
    ['search.go.in', 'pkg/common/storage/database/mgo/im_app_retention_search.go'],
    ['body_purge.go.in', 'internal/rpc/msg/im_app_retention_body_purge.go'],
    ['body_purge_test.go.in', 'internal/rpc/msg/im_app_retention_body_purge_test.go'],
    ['write_fence.go.in', 'pkg/common/storage/database/mgo/im_app_retention_write_fence.go'],
    ['transfer_test.go.in', 'pkg/common/storage/controller/im_app_retention_transfer_test.go'],
  ]) {
    const target = path.join(root, dest)
    if (fs.existsSync(target)) throw new Error('Requires a fresh checkout')
    changes.push([target, fs.readFileSync(path.join(__dirname, template), 'utf8')])
  }
  // Validate every input/anchor before touching even the disposable checkout.
  for (const [target, data] of changes) { fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, data) }
  execFileSync('gofmt', ['-w', ...changes.map(([target]) => target)])
}
module.exports = { apply, transform, hashes }
if (require.main === module) apply(process.argv[2])
