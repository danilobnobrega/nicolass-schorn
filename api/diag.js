// receives the phone diagnostics and writes them to this project's Vercel logs
export default function handler(req, res) {
  let body = req.body;
  if (typeof body !== 'string') body = JSON.stringify(body);
  console.log('DIAG ' + String(body).slice(0, 6000));
  res.status(204).end();
}
