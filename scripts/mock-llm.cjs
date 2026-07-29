#!/usr/bin/env node
// Mock de backend OpenAI-compatible — pour tester Hanami sans vrai LLM.
// Lance : npm run mock-llm  (écoute sur http://127.0.0.1:5199/v1)
const http = require('node:http')

const PORT = 5199
const REPLIES = [
  "[happy] Hehe~ I'm here! The mock backend is working perfectly. What should we test next?",
  '[surprised] No way! Streaming works! I can see the words appear one by one~',
  "[relaxed] Everything looks fine on my side. I'm sure everything will be alright!",
]
let replyIndex = 0

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
  })
}

function sseChunk(delta, finish = null) {
  return (
    'data: ' +
    JSON.stringify({
      id: 'mock-1',
      object: 'chat.completion.chunk',
      model: 'mock-sakura',
      choices: [{ index: 0, delta, finish_reason: finish }],
    }) +
    '\n\n'
  )
}

const server = http.createServer(async (req, res) => {
  if (req.url.endsWith('/models')) {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ object: 'list', data: [{ id: 'mock-sakura', object: 'model' }] }))
    return
  }
  if (req.url.endsWith('/chat/completions')) {
    const body = JSON.parse((await readBody(req)) || '{}')
    const messages = body.messages || []
    const lastUser = [...messages].reverse().find((m) => m.role === 'user')
    const hasToolResult = messages.some((m) => m.role === 'tool')
    const wantsMemory =
      body.tools?.some((t) => t.function?.name === 'memory_save') &&
      lastUser && /remember|souviens|retiens/i.test(String(lastUser.content)) &&
      !hasToolResult

    // Cas outil : le user demande de mémoriser → émettre un tool_call memory_save.
    if (wantsMemory) {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' })
      res.write(
        sseChunk({
          role: 'assistant',
          tool_calls: [
            {
              index: 0,
              id: 'call_mock_1',
              type: 'function',
              function: {
                name: 'memory_save',
                arguments: JSON.stringify({
                  name: 'test-mock.md',
                  content: '# Test\n\nFait mémorisé par le mock : ' + String(lastUser.content).slice(0, 120),
                  indexLine: '- [Test mock](test-mock.md) — fait de test enregistré par le mock',
                }),
              },
            },
          ],
        })
      )
      res.write(sseChunk({}, 'tool_calls'))
      res.write('data: [DONE]\n\n')
      res.end()
      return
    }

    const text = hasToolResult
      ? "[happy] Done! I saved that in my memory so I won't forget~"
      : REPLIES[replyIndex++ % REPLIES.length]
    const words = text.split(/(?<= )/)

    if (body.stream) {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' })
      res.write(sseChunk({ role: 'assistant', content: '' }))
      let i = 0
      const timer = setInterval(() => {
        if (i < words.length) {
          res.write(sseChunk({ content: words[i++] }))
        } else {
          clearInterval(timer)
          res.write(sseChunk({}, 'stop'))
          res.write('data: [DONE]\n\n')
          res.end()
        }
      }, 30)
      req.on('close', () => clearInterval(timer))
    } else {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(
        JSON.stringify({
          id: 'mock-1',
          object: 'chat.completion',
          model: 'mock-sakura',
          choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }],
        })
      )
    }
    return
  }
  res.writeHead(404).end('mock-llm: route inconnue ' + req.url)
})

server.listen(PORT, () => console.log(`[mock-llm] OpenAI-compat sur http://127.0.0.1:${PORT}/v1`))
