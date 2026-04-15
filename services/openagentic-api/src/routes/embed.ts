/**
 * Copyright 2026 Gnomus.ai
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * Embed Routes — Serve embeddable workflow widgets
 *
 * GET  /embed/widget.js           — Embeddable chat widget JS bundle
 * GET  /embed/:workflowId         — iFrame-able workflow runner page
 * POST /embed/:workflowId/execute — Execute workflow from embed (validates API key)
 */

import crypto from 'crypto';
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../utils/prisma.js';
import { loggers } from '../utils/logger.js';

const logger = loggers.routes;

export async function embedRoutes(fastify: FastifyInstance) {

  // ─── Widget JS Bundle ───────────────────────────────────────────────
  // Serves a self-contained JS snippet that creates a chat widget
  fastify.get('/widget.js', async (_req: FastifyRequest, reply: FastifyReply) => {
    reply.header('Content-Type', 'application/javascript');
    reply.header('Cache-Control', 'public, max-age=3600');
    return reply.send(WIDGET_JS);
  });

  // ─── iFrame Runner Page ─────────────────────────────────────────────
  fastify.get<{ Params: { workflowId: string }; Querystring: { theme?: string; title?: string } }>(
    '/:workflowId',
    async (req, reply) => {
      const { workflowId } = req.params;
      const theme = (req.query as any).theme || 'dark';
      const title = (req.query as any).title || 'OpenAgentic Flow';

      // Verify workflow exists and is public or has a webhook
      try {
        const workflow = await prisma.workflow.findUnique({
          where: { id: workflowId },
          select: { id: true, name: true, is_public: true },
        });
        if (!workflow) {
          reply.code(404);
          return reply.send('Workflow not found');
        }
      } catch {
        reply.code(404);
        return reply.send('Workflow not found');
      }

      reply.header('Content-Type', 'text/html');
      return reply.send(renderEmbedPage(workflowId, theme, title));
    }
  );

  // ─── Execute from Embed ─────────────────────────────────────────────
  fastify.post<{ Params: { workflowId: string } }>(
    '/:workflowId/execute',
    async (req, reply) => {
      const { workflowId } = req.params;
      const apiKey = req.headers['x-api-key'] as string;

      if (!apiKey) {
        reply.code(401);
        return reply.send({ error: 'API key required' });
      }

      // Validate API key
      const bcrypt = await import('bcrypt');
      const keys = await prisma.apiKey.findMany({
        where: { is_active: true },
        select: { id: true, key_hash: true, user_id: true },
      });

      let userId: string | null = null;
      for (const key of keys) {
        if (await bcrypt.compare(apiKey, key.key_hash)) {
          userId = key.user_id;
          break;
        }
      }

      if (!userId) {
        reply.code(403);
        return reply.send({ error: 'Invalid API key' });
      }

      // Verify workflow access
      const workflow = await prisma.workflow.findFirst({
        where: {
          id: workflowId,
          OR: [
            { is_public: true },
            { created_by: userId },
            { shares: { some: { target_id: userId, role: { in: ['executor', 'editor', 'admin'] } } } } as any,
          ],
        },
      });

      if (!workflow) {
        reply.code(404);
        return reply.send({ error: 'Workflow not found or access denied' });
      }

      // Execute workflow
      const { executeWorkflow } = await import('../services/WorkflowExecutionEngine.js');
      const definition = (workflow as any).definition || { nodes: [], edges: [] };
      const input = (req.body as any)?.input || {};
      const executionId = crypto.randomUUID();

      // SSE streaming response
      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'Access-Control-Allow-Origin': '*',
      });

      try {
        const result = await executeWorkflow(
          workflowId,
          executionId,
          definition,
          input,
          userId,
          undefined,
          (event) => {
            reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
          }
        );
        reply.raw.write(`data: ${JSON.stringify({ type: 'execution_complete', data: { status: result.success ? 'completed' : 'failed', output: result.output, error: result.error } })}\n\n`);
      } catch (err: any) {
        reply.raw.write(`data: ${JSON.stringify({ type: 'execution_error', data: { error: err.message } })}\n\n`);
      } finally {
        reply.raw.write('data: [DONE]\n\n');
        reply.raw.end();
      }
      return reply;
    }
  );
}

// ─── Embeddable Widget JS ───────────────────────────────────────────────
const WIDGET_JS = `
(function() {
  'use strict';
  var OpenAgenticWidget = {
    init: function(config) {
      if (!config || !config.webhookKey) {
        console.error('OpenAgenticWidget: webhookKey is required');
        return;
      }
      var baseUrl = config.baseUrl || window.location.origin;
      var theme = config.theme || 'dark';
      var title = config.title || 'OpenAgentic';
      var position = config.position || 'bottom-right';
      var accent = config.accentColor || '#7c4dff';

      var isDark = theme === 'dark';
      var bgColor = isDark ? '#1C1C1E' : '#ffffff';
      var textColor = isDark ? '#e5e5e7' : '#1d1d1f';
      var borderColor = isDark ? '#333' : '#e0e0e0';
      var inputBg = isDark ? '#2C2C2E' : '#f5f5f5';

      // Create container
      var container = document.createElement('div');
      container.id = 'aww-container';
      container.style.cssText = 'position:fixed;z-index:99999;' +
        (position.includes('bottom') ? 'bottom:20px;' : 'top:20px;') +
        (position.includes('right') ? 'right:20px;' : 'left:20px;') +
        'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;';

      // Toggle button
      var btn = document.createElement('button');
      btn.id = 'aww-toggle';
      btn.innerHTML = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';
      btn.style.cssText = 'width:56px;height:56px;border-radius:28px;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;box-shadow:0 4px 12px rgba(0,0,0,0.3);background:' + accent + ';';

      // Chat panel
      var panel = document.createElement('div');
      panel.id = 'aww-panel';
      panel.style.cssText = 'display:none;width:380px;height:520px;border-radius:16px;overflow:hidden;box-shadow:0 8px 32px rgba(0,0,0,0.25);margin-bottom:12px;flex-direction:column;background:' + bgColor + ';border:1px solid ' + borderColor + ';';

      // Header
      var header = document.createElement('div');
      header.style.cssText = 'padding:14px 16px;font-size:14px;font-weight:600;border-bottom:1px solid ' + borderColor + ';color:' + textColor + ';display:flex;align-items:center;justify-content:space-between;';
      header.innerHTML = '<span>' + title + '</span><button id="aww-close" style="background:none;border:none;cursor:pointer;color:' + textColor + ';opacity:0.5;font-size:18px;">&times;</button>';

      // Messages area
      var messages = document.createElement('div');
      messages.id = 'aww-messages';
      messages.style.cssText = 'flex:1;overflow-y:auto;padding:12px 16px;display:flex;flex-direction:column;gap:8px;';

      // Input area
      var inputArea = document.createElement('div');
      inputArea.style.cssText = 'padding:12px;border-top:1px solid ' + borderColor + ';display:flex;gap:8px;';
      var input = document.createElement('input');
      input.id = 'aww-input';
      input.placeholder = config.placeholder || 'Type your message...';
      input.style.cssText = 'flex:1;padding:10px 14px;border-radius:10px;border:1px solid ' + borderColor + ';font-size:13px;outline:none;background:' + inputBg + ';color:' + textColor + ';';
      var sendBtn = document.createElement('button');
      sendBtn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>';
      sendBtn.style.cssText = 'width:40px;height:40px;border-radius:10px;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;background:' + accent + ';';
      inputArea.appendChild(input);
      inputArea.appendChild(sendBtn);

      panel.appendChild(header);
      panel.appendChild(messages);
      panel.appendChild(inputArea);
      container.appendChild(panel);
      container.appendChild(btn);
      document.body.appendChild(container);

      var isOpen = false;
      btn.onclick = function() {
        isOpen = !isOpen;
        panel.style.display = isOpen ? 'flex' : 'none';
        if (isOpen) input.focus();
      };
      panel.querySelector('#aww-close').onclick = function() {
        isOpen = false;
        panel.style.display = 'none';
      };

      function addMessage(text, isUser) {
        var msg = document.createElement('div');
        msg.style.cssText = 'max-width:85%;padding:10px 14px;border-radius:12px;font-size:13px;line-height:1.5;word-wrap:break-word;' +
          (isUser
            ? 'align-self:flex-end;background:' + accent + ';color:white;border-bottom-right-radius:4px;'
            : 'align-self:flex-start;background:' + inputBg + ';color:' + textColor + ';border-bottom-left-radius:4px;');
        msg.textContent = text;
        messages.appendChild(msg);
        messages.scrollTop = messages.scrollHeight;
        return msg;
      }

      function sendMessage() {
        var text = input.value.trim();
        if (!text) return;
        input.value = '';
        addMessage(text, true);

        var replyEl = addMessage('...', false);

        var url = baseUrl + '/api/v1/hooks/' + config.webhookKey;
        var headers = { 'Content-Type': 'application/json' };
        if (config.apiKey) headers['X-API-Key'] = config.apiKey;

        fetch(url, { method: 'POST', headers: headers, body: JSON.stringify({ input: { query: text } }) })
          .then(function(res) {
            if (!res.ok) throw new Error('Request failed: ' + res.status);
            return res.text();
          })
          .then(function(data) {
            try { var json = JSON.parse(data); replyEl.textContent = json.output || json.result || data; }
            catch(e) { replyEl.textContent = data; }
          })
          .catch(function(err) { replyEl.textContent = 'Error: ' + err.message; replyEl.style.color = '#f44336'; });
      }

      sendBtn.onclick = sendMessage;
      input.onkeydown = function(e) { if (e.key === 'Enter') sendMessage(); };
    }
  };
  if (typeof window !== 'undefined') window.OpenAgenticWidget = OpenAgenticWidget;
})();
`;

// ─── Embed Page HTML ────────────────────────────────────────────────────
function renderEmbedPage(workflowId: string, theme: string, title: string): string {
  const isDark = theme === 'dark';
  const bg = isDark ? '#1C1C1E' : '#ffffff';
  const text = isDark ? '#e5e5e7' : '#1d1d1f';
  const border = isDark ? '#333' : '#e0e0e0';
  const inputBg = isDark ? '#2C2C2E' : '#f5f5f5';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>${title}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:${bg};color:${text};height:100vh;display:flex;flex-direction:column}
#header{padding:14px 20px;font-size:15px;font-weight:600;border-bottom:1px solid ${border}}
#messages{flex:1;overflow-y:auto;padding:16px 20px;display:flex;flex-direction:column;gap:10px}
.msg{max-width:85%;padding:10px 16px;border-radius:14px;font-size:14px;line-height:1.6;word-wrap:break-word}
.msg.user{align-self:flex-end;background:#7c4dff;color:#fff;border-bottom-right-radius:4px}
.msg.bot{align-self:flex-start;background:${inputBg};border-bottom-left-radius:4px}
#input-area{padding:14px 20px;border-top:1px solid ${border};display:flex;gap:10px}
#input{flex:1;padding:12px 16px;border-radius:12px;border:1px solid ${border};font-size:14px;outline:none;background:${inputBg};color:${text}}
#send{width:44px;height:44px;border-radius:12px;border:none;cursor:pointer;background:#7c4dff;color:#fff;font-size:18px}
#send:hover{background:#6a3de8}
.typing{opacity:0.5;font-style:italic}
</style>
</head>
<body>
<div id="header">${title}</div>
<div id="messages"></div>
<div id="input-area">
<input id="input" placeholder="Type a message..." autocomplete="off">
<button id="send">&#8593;</button>
</div>
<script>
var WF_ID='${workflowId}';
var msgs=document.getElementById('messages');
var input=document.getElementById('input');
function addMsg(t,cls){var d=document.createElement('div');d.className='msg '+cls;d.textContent=t;msgs.appendChild(d);msgs.scrollTop=msgs.scrollHeight;return d}
function send(){var t=input.value.trim();if(!t)return;input.value='';addMsg(t,'user');var r=addMsg('Thinking...','bot typing');
var apiKey=new URLSearchParams(window.location.search).get('apiKey')||'';
var h={'Content-Type':'application/json'};if(apiKey)h['X-API-Key']=apiKey;
fetch('/embed/'+WF_ID+'/execute',{method:'POST',headers:h,body:JSON.stringify({input:{query:t}})})
.then(function(res){return res.text()}).then(function(data){
try{var lines=data.split('\\n');var last='';
lines.forEach(function(l){if(l.startsWith('data: ')&&l!=='data: [DONE]'){try{var e=JSON.parse(l.slice(6));if(e.type==='execution_complete'&&e.data)last=JSON.stringify(e.data.output)||'Done';if(e.type==='execution_error'&&e.data)last='Error: '+e.data.error;}catch(x){}}});
r.textContent=last||data;r.classList.remove('typing');}catch(e){r.textContent=data;r.classList.remove('typing');}
}).catch(function(e){r.textContent='Error: '+e.message;r.classList.remove('typing');r.style.color='#f44336';});}
document.getElementById('send').onclick=send;
input.onkeydown=function(e){if(e.key==='Enter')send()};
input.focus();
</script>
</body>
</html>`;
}
