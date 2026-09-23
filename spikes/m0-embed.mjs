import { env, pipeline } from '@huggingface/transformers'
env.localModelPath = 'E:/Deepseek_Harness/spike-dshpw/storage/.docshield/models/'
env.allowRemoteModels = false
const mb = () => Math.round(process.memoryUsage().rss / 1048576)
let t = performance.now()
const embed = await pipeline('feature-extraction', 'Xenova/bge-m3', { dtype: 'q8' })
console.log('load ms', Math.round(performance.now() - t), 'rss MB', mb())
const docs = [
  'Mã số cá nhân của Alice là AL-99.',
  'Điều 5. Sinh viên có điểm trung bình từ 3.2 trở lên được xét học bổng khuyến khích học tập.',
  'Thư viện mở cửa từ 7h30 đến 21h các ngày trong tuần.',
  'Sinh viên được hỗ trợ vay vốn theo chương trình tín dụng của ngân hàng chính sách xã hội.',
]
t = performance.now()
const D = await embed(docs, { pooling: 'cls', normalize: true })
console.log('embed 4 docs ms', Math.round(performance.now() - t), 'dims', D.dims, 'rss MB', mb())
const long = 'Quy chế đào tạo. '.repeat(120)
t = performance.now(); await embed([long], { pooling: 'cls', normalize: true })
console.log('embed ~2000 chars ms', Math.round(performance.now() - t))
const dv = D.tolist()
for (const q of ['Làm sao để được học bổng?', 'Trường có cho sinh viên vay 100 triệu mua xe máy không?', 'Thư viện đóng cửa lúc mấy giờ?']) {
  const [qv] = (await embed([q], { pooling: 'cls', normalize: true })).tolist()
  const s = dv.map((d, i) => [i, d.reduce((a, x, j) => a + x * qv[j], 0).toFixed(3)])
  console.log(q, '=>', s.sort((a, b) => b[1] - a[1]).map(([i, v]) => `#${i}:${v}`).join(' '))
}
console.log('peak rss MB', mb())
