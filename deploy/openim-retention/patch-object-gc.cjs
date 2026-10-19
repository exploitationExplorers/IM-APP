'use strict'
// Extends a fresh, pinned checkout AFTER retention.apply(). Never a live path.
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const productionScope = require('../oss-production/openim-scope/patch-openim.cjs')

function once(s, a, b) {
  if (s.split(a).length !== 2) throw new Error('GC pinned anchor changed: '+a.slice(0,70))
  return s.replace(a,b)
}
function apply(root) {
  root = fs.realpathSync(root)
  if (/\/pkg\/mod\//i.test(root.replaceAll('\\','/'))) throw new Error('Refusing module cache')
  productionScope.apply(root) // verifies pinned third.go, s3.go, tools revision
  const files = []
  function edit(name, transform) {
    const file = path.join(root,name)
    const source = fs.readFileSync(file,'utf8')
    const result = transform(source)
    if (result === source) throw new Error('No GC patch: '+name)
    files.push([file,result])
  }
  const imp = s => once(s,'import (','import (\n\tgc "github.com/openimsdk/open-im-server/v3/internal/imappgc"')
  edit('internal/rpc/third/third.go', s => {
    s = imp(s)
    s = once(s,'\to, err = scopedoss.New(', '\trawOSS := o\n\to, err = scopedoss.New(')
    return once(s,'\tuserConn, err :=', `\tif !gc.Enabled() { return fmt.Errorf("managed production media requires reference fencing") }
\tif gc.Enabled() {
\t\tgc.Bind(mgocli.GetDB())
\t\ttracked := &imAppGCStore{Interface:o, raw:rawOSS, db:mgocli.GetDB()}
\t\tif err := startIMAppGC(ctx, tracked); err != nil { return err }
\t\to = tracked
\t}
\tuserConn, err :=`)
  })
  edit('internal/rpc/third/s3.go', s => once(imp(s),
    '\t\tkey = path.Join(cont.DirectPath, date, opUserID, hex.EncodeToString(uid[:])+path.Ext(req.Name))',
    '\t\tkey = path.Join(gc.Namespace, cont.DirectPath, date, opUserID, hex.EncodeToString(uid[:])+path.Ext(req.Name))'))
  edit('production-tools/s3/cont/controller.go', s => {
    s = once(s,'return path.Join(hashPath, md5)','return path.Join("managed-v1", hashPath, md5)')
    return once(s,'\n\t\tkey := path.Join(tempPath, c.NowPath(),','\n\t\tkey := path.Join("managed-v1", tempPath, c.NowPath(),')
  })
  edit('production-tools/s3/oss/oss.go', s => once(once(s,
    'return o.bucket.DeleteObject(name)', 'return o.bucket.DeleteObject(name, oss.WithContext(ctx))'),
    'o.bucket.GetObjectMeta(name)', 'o.bucket.GetObjectMeta(name, oss.WithContext(ctx))'))
  // A 12-hour positive stat cache must NEVER resurrect a tombstoned hash.
  edit('pkg/common/storage/cache/redis/s3.go', s => once(imp(s),
    'func (g *s3CacheRedis) GetKey(ctx context.Context, engine string, name string) (*s3.ObjectInfo, error) {',
    'func (g *s3CacheRedis) GetKey(ctx context.Context, engine string, name string) (*s3.ObjectInfo, error) {\n\tif gc.Managed(name) { return g.s3.StatObject(ctx, name) }'))
  edit('pkg/common/storage/database/mgo/object.go', s => once(once(imp(s),
    'func (o *S3Mongo) SetObject(ctx context.Context, obj *model.Object) error {',
    `func (o *S3Mongo) SetObject(ctx context.Context, obj *model.Object) error {
\tif gc.Enabled() {
\t\tif err := gc.Touch(ctx,o.coll.Database(),obj.Key,obj.Size,false); err != nil { return err }
\t}`), '\tfilter := bson.M{"name": obj.Name, "engine": obj.Engine}',
    `\tfilter := bson.M{"name": obj.Name, "engine": obj.Engine}
\tif gc.Enabled() {
\t\tif gc.Managed(obj.Key) { filter["key"] = obj.Key } else {
\t\t\tfilter["key"] = bson.M{"$not":bson.M{"$regex":"^managed-v1/"}}
\t\t}
\t}`))
  edit('pkg/common/storage/database/mgo/msg.go',s => once(imp(s),
    'func NewMsgMongo(db *mongo.Database) (database.Msg, error) {',
    'func NewMsgMongo(db *mongo.Database) (database.Msg, error) {\n\tgc.Bind(db)'))
  edit('pkg/common/storage/controller/msg.go', s => once(imp(s),
    'func (db *commonMsgDatabase) MsgToMQ(ctx context.Context, key string, msg2mq *sdkws.MsgData) error {',
    `func (db *commonMsgDatabase) MsgToMQ(ctx context.Context, key string, msg2mq *sdkws.MsgData) error {
\tif gc.Enabled() && msg2mq != nil {
\t\tvar claim *gc.Claim
\t\tif msg2mq.SessionType == constant.ReadGroupChatType { claim = &gc.Claim{Group:msg2mq.GroupID,Sender:msg2mq.SendID,Message:msg2mq.ClientMsgID} }
\t\tif err := gc.Protect(ctx,gc.Database(),string(msg2mq.Content),claim); err != nil { return err }
\t\tif err := gc.ProtectValue(ctx,gc.Database(),[]string{msg2mq.SenderFaceURL,msg2mq.AttachedInfo,msg2mq.Ex}); err != nil { return err }
\t}`))
  for (const [kind,typ,create,update] of [
    ['user','UserMgo','users []*model.User','UpdateByMap'],
    ['group','GroupMgo','groups []*model.Group','UpdateMap'],
    ['group_member','GroupMemberMgo','groupMembers []*model.GroupMember','Update'],
  ]) {
    edit(`pkg/common/storage/database/mgo/${kind}.go`, s => {
      s = imp(s)
      const receiver = kind === 'user' ? 'u' : 'g'
      const variable = kind === 'user' ? 'users' : kind === 'group' ? 'groups' : 'groupMembers'
      if(kind!=='group_member'){
        const constructor=kind==='user'?'func NewUserMongo(db *mongo.Database) (database.User, error) {':'func NewGroupMongo(db *mongo.Database) (database.Group, error) {'
        s=once(s,constructor,constructor+'\n\tgc.Bind(db)')
      }
      s = once(s, `return mongoutil.InsertMany(ctx, ${receiver}.coll, ${variable})`,
        `if err := gc.ProtectValue(ctx,${receiver}.coll.Database(),${variable}); err != nil { return err }\n\treturn mongoutil.InsertMany(ctx, ${receiver}.coll, ${variable})`)
      const signature = kind === 'group_member' ? 'groupID string, userID string, data map[string]any' : `${kind}ID string, args map[string]any`
      const anchor = `func (${receiver} *${typ}) ${update}(ctx context.Context, ${signature}) (err error) {`
      s = once(s, anchor, anchor+`\n\tif err := gc.ProtectValue(ctx,${receiver}.coll.Database(),${kind === 'group_member' ? 'data' : 'args'}); err != nil { return err }`)
      if (kind === 'user') {
        for (const [signature,value] of [
          ['AddUserCommand(ctx context.Context, userID string, Type int32, UUID string, value string, ex string) error {','[]string{value,ex}'],
          ['UpdateUserCommand(ctx context.Context, userID string, Type int32, UUID string, val map[string]any) error {','val'],
        ]) s = once(s, signature, signature+`\n\tif err := gc.ProtectValue(ctx,u.coll.Database(),${value}); err != nil { return err }`)
      }
      return s
    })
  }
  for (const [template,dest] of [
    ['object_gc.go.in','internal/imappgc/gc.go'],
    ['object_gc_oss.go.in','production-tools/s3/oss/im_app_media_gc.go'],
    ['object_gc_oss_test.go.in','production-tools/s3/oss/im_app_media_gc_test.go'],
    ['object_gc_test.go.in','internal/imappgc/gc_test.go'],
    ['object_gc_store.go.in','internal/rpc/third/im_app_media_gc_store.go'],
    ['object_gc_http.go.in','internal/rpc/third/im_app_media_gc_http.go'],
    ['object_gc_http_test.go.in','internal/rpc/third/im_app_media_gc_http_test.go'],
    ['object_gc_store_test.go.in','internal/rpc/third/im_app_media_gc_store_test.go'],
    ['object_gc_mgo_test.go.in','pkg/common/storage/database/mgo/im_app_media_gc_test.go'],
  ]) files.push([path.join(root,dest),fs.readFileSync(path.join(__dirname,template),'utf8')])
  for (const [file,data] of files) {fs.mkdirSync(path.dirname(file),{recursive:true});fs.chmodSync(path.dirname(file),0o755);if(fs.existsSync(file))fs.chmodSync(file,0o644);fs.writeFileSync(file,data)}
  execFileSync('gofmt',['-w',...files.map(([file])=>file)])
}
module.exports = {apply,once}
if (require.main === module) apply(process.argv[2])
