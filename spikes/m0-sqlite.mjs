import { DatabaseSync } from 'node:sqlite'
import { getLoadablePath } from 'sqlite-vec'

const db = new DatabaseSync(':memory:', { allowExtension: true })
db.loadExtension(getLoadablePath())
console.log('vec_version', db.prepare('select vec_version() v').get().v)

db.exec(`create virtual table v using vec0(scope text partition key, embedding float[4] distance_metric=cosine)`)
const ins = db.prepare('insert into v(rowid, scope, embedding) values (?, ?, ?)')
const vec = a => new Uint8Array(new Float32Array(a).buffer)
ins.run(1n, 'user:alice', vec([1, 0, 0, 0]))
ins.run(2n, 'user:bob', vec([1, 0, 0, 0]))
ins.run(3n, 'public', vec([0.9, 0.1, 0, 0]))
const q = db.prepare('select rowid, distance from v where embedding match ? and k = 5 and scope = ?')
console.log('bob sees', q.all(vec([1, 0, 0, 0]), 'user:bob'))
console.log('public', q.all(vec([1, 0, 0, 0]), 'public'))

db.exec(`create virtual table f using fts5(text, tokenize = 'unicode61 remove_diacritics 2')`)
db.prepare('insert into f(rowid, text) values (?, ?)').run(1n, 'Mã số cá nhân của Alice là AL-99. Điều 5: Học bổng khuyến khích.')
for (const term of ['"AL-99"', 'hoc bong', 'học bổng', '"Điều 5"'])
  console.log('fts', term, db.prepare('select rowid, bm25(f) s from f where f match ?').all(term))
