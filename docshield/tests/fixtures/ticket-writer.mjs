// TC-06 helper: one OS process opens the shared DB, waits for a common start
// instant, creates one ticket and prints its code.
//   node ticket-writer.mjs <dbFile> <userId> <startAtEpochMs>
import { openDatabase } from '../../dist/db/database.js'
import { TicketStore } from '../../dist/db/tickets.js'

const [dbFile, userId, startAt] = process.argv.slice(2)
const db = openDatabase(dbFile)
const store = new TicketStore(db)
while (Date.now() < Number(startAt)) { /* spin to align the writers */ }
const { ticket } = store.create({ userId, sessionId: `s-${userId}`, question: `Câu hỏi ngoài phạm vi của ${userId}`, reason: 'không có trong tài liệu' })
db.close()
process.stdout.write(ticket.code)
