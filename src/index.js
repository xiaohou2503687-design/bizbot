const fs = require("fs");
const path = require("path");
const chalk = require("chalk");

// Simple text chunker for document ingestion
function chunkText(text, maxLen = 500) {
  const chunks = [];
  const paragraphs = text.split(/\n\n+/);
  let current = "";
  
  for (const p of paragraphs) {
    const trimmed = p.trim();
    if (!trimmed) continue;
    if ((current + " " + trimmed).length > maxLen && current) {
      chunks.push(current.trim());
      current = trimmed;
    } else {
      current = current ? current + "\n\n" + trimmed : trimmed;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

// Ingest documents
async function ingest(inputPath, options = {}) {
  const absPath = path.resolve(inputPath);
  const outputPath = path.resolve(options.output || "./bizbot-data");
  
  if (!fs.existsSync(outputPath)) {
    fs.mkdirSync(outputPath, { recursive: true });
  }
  
  const documents = [];
  const files = [];
  
  function walkDir(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walkDir(full);
      } else if (/\.(md|txt|html|json|yml|yaml)$/i.test(entry.name)) {
        files.push(full);
      }
    }
  }
  
  if (fs.statSync(absPath).isDirectory()) {
    walkDir(absPath);
  } else {
    files.push(absPath);
  }
  
  for (const file of files) {
    try {
      const content = fs.readFileSync(file, "utf-8");
      const chunks = chunkText(content, 500);
      const relPath = path.relative(absPath, file);
      
      for (let i = 0; i < chunks.length; i++) {
        documents.push({
          id: `${relPath.replace(/[^a-zA-Z0-9]/g, "_")}_${i}`,
          source: relPath,
          chunk: i,
          text: chunks[i]
        });
      }
    } catch (e) {
      console.warn(chalk.yellow(`  ⚠ Skipped ${file}: ${e.message}`));
    }
  }
  
  // Save knowledge base
  const kb = {
    name: options.name || "Support Bot",
    created: new Date().toISOString(),
    docCount: documents.length,
    fileCount: files.length,
    documents
  };
  
  fs.writeFileSync(
    path.join(outputPath, "knowledge-base.json"),
    JSON.stringify(kb, null, 2)
  );
  
  console.log(chalk.cyan(`\n🤖 BizBot Knowledge Base Created:`));
  console.log(chalk.green(`  📁 ${files.length} files processed`));
  console.log(chalk.green(`  📄 ${documents.length} chunks indexed`));
  console.log(chalk.green(`  💾 Saved to ${outputPath}/knowledge-base.json\n`));
  
  return { docCount: documents.length, outputPath };
}

// Simple keyword search
function search(kb, query, topK = 5) {
  const queryLower = query.toLowerCase();
  const queryWords = queryLower.split(/\s+/).filter(w => w.length > 1);
  
  const scored = kb.documents.map(doc => {
    const textLower = doc.text.toLowerCase();
    let score = 0;
    
    // Exact phrase match
    if (textLower.includes(queryLower)) score += 10;
    
    // Word matches
    for (const word of queryWords) {
      const regex = new RegExp(word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
      const matches = textLower.match(regex);
      if (matches) score += matches.length * 2;
    }
    
    // Title/heading bonus
    if (/^#+\s|^[A-Z][^a-z]/.test(doc.text)) score += 3;
    
    return { ...doc, score };
  });
  
  return scored
    .filter(d => d.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}

// Generate answer from search results
function generateAnswer(query, results, botName) {
  if (results.length === 0) {
    return {
      answer: `I couldn't find specific information about "${query}" in my knowledge base. Try rephrasing your question, or check our docs for more details.`,
      sources: [],
      confidence: 0
    };
  }
  
  const topResult = results[0];
  const answer = topResult.text;
  const confidence = Math.min(1, topResult.score / 15);
  const sources = [...new Set(results.map(r => r.source))];
  
  return { answer, sources, confidence };
}

// Start chatbot server
async function serve(options = {}) {
  const express = require("express");
  const cors = require("cors");
  const app = express();
  const port = parseInt(options.port) || 3456;
  const dataPath = path.resolve(options.data || "./bizbot-data");
  const apiKey = options.apiKey;
  
  app.use(cors());
  app.use(express.json());
  
  // Load knowledge base
  let kb = null;
  const kbPath = path.join(dataPath, "knowledge-base.json");
  if (fs.existsSync(kbPath)) {
    kb = JSON.parse(fs.readFileSync(kbPath, "utf-8"));
    console.log(chalk.green(`📚 Loaded knowledge base: ${kb.docCount} chunks`));
  } else {
    console.log(chalk.yellow("⚠️  No knowledge base found. Run 'bizbot ingest <docs>' first."));
    kb = { name: "Support Bot", documents: [] };
  }
  
  // Serve widget
  const widgetPath = path.join(dataPath, "..", "widget", "bizbot-widget.js");
  app.get("/widget.js", (req, res) => {
    if (fs.existsSync(widgetPath)) {
      res.type("application/javascript");
      res.sendFile(path.resolve(widgetPath));
    } else {
      // Inline minimal widget
      res.type("application/javascript");
      res.send(generateWidgetJS(options));
    }
  });
  
  // Chat endpoint
  app.post("/chat", async (req, res) => {
    const { message } = req.body;
    if (!message) return res.status(400).json({ error: "Message required" });
    
    // Search local KB
    const results = search(kb, message);
    const localAnswer = generateAnswer(message, results, kb.name);
    
    // If API key provided, enhance with AI
    if (apiKey && localAnswer.confidence < 0.7) {
      try {
        const aiAnswer = await enhanceWithAI(message, results, apiKey);
        return res.json(aiAnswer);
      } catch (e) {
        // Fall back to local
      }
    }
    
    res.json(localAnswer);
  });
  
  // Health check
  app.get("/health", (req, res) => {
    res.json({ status: "ok", docs: kb.docCount, name: kb.name });
  });
  
  app.listen(port, () => {
    console.log(chalk.cyan(`\n🤖 BizBot Server Running:`));
    console.log(chalk.green(`  🌐 http://localhost:${port}`));
    console.log(chalk.green(`  📋 Widget: http://localhost:${port}/widget.js`));
    console.log(chalk.gray(`  💡 Embed: <script src="http://localhost:${port}/widget.js"></script>\n`));
  });
}

// AI enhancement (optional)
async function enhanceWithAI(query, results, apiKey) {
  const context = results.slice(0, 3).map(r => r.text).join("\n\n");
  const prompt = `You are a helpful customer support bot. Answer the question based on the context below. If the context doesn't contain the answer, say so politely.\n\nContext:\n${context}\n\nQuestion: ${query}\n\nAnswer:`;
  
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 300,
      temperature: 0.3
    })
  });
  
  const data = await response.json();
  return {
    answer: data.choices[0].message.content,
    sources: [...new Set(results.map(r => r.source))],
    confidence: 0.9,
    ai: true
  };
}

// Build widget script
async function buildWidget(options = {}) {
  const outputPath = path.resolve(options.output || "./bizbot-widget.js");
  const serverUrl = options.server || "http://localhost:3456";
  
  const widgetJS = generateWidgetJS({ server: serverUrl });
  fs.writeFileSync(outputPath, widgetJS);
  
  console.log(chalk.green(`✅ Widget generated: ${outputPath}`));
  console.log(chalk.gray(`   Embed: <script src="${serverUrl}/widget.js"></script>`));
}

function generateWidgetJS(options = {}) {
  const serverUrl = options.server || "http://localhost:3456";
  return `
(function() {
  if (window.__bizbot_loaded) return;
  window.__bizbot_loaded = true;
  
  var server = "${serverUrl}";
  
  // Styles
  var style = document.createElement("style");
  style.textContent = \`
    #bizbot-widget { position:fixed; bottom:20px; right:20px; z-index:9999; font-family:-apple-system,BlinkMacSystemFont,sans-serif; }
    #bizbot-toggle { width:56px; height:56px; border-radius:50%; background:linear-gradient(135deg,#00d4ff,#7b2ff7); border:none; cursor:pointer; box-shadow:0 4px 20px rgba(0,0,0,.3); font-size:24px; color:#fff; transition:transform .2s; }
    #bizbot-toggle:hover { transform:scale(1.1); }
    #bizbot-chat { display:none; position:absolute; bottom:70px; right:0; width:340px; height:450px; background:#fff; border-radius:16px; box-shadow:0 8px 40px rgba(0,0,0,.15); overflow:hidden; flex-direction:column; }
    #bizbot-chat.open { display:flex; }
    #bizbot-header { background:linear-gradient(135deg,#00d4ff,#7b2ff7); color:#fff; padding:16px 20px; font-weight:700; font-size:15px; }
    #bizbot-messages { flex:1; overflow-y:auto; padding:16px; display:flex; flex-direction:column; gap:10px; }
    .bizbot-msg { max-width:85%; padding:10px 14px; border-radius:12px; font-size:13px; line-height:1.5; }
    .bizbot-msg.bot { background:#f0f4ff; color:#1a1a2e; align-self:flex-start; }
    .bizbot-msg.user { background:linear-gradient(135deg,#00d4ff,#7b2ff7); color:#fff; align-self:flex-end; }
    #bizbot-input-wrap { display:flex; padding:12px; border-top:1px solid #eee; }
    #bizbot-input { flex:1; border:1px solid #ddd; border-radius:20px; padding:10px 16px; font-size:13px; outline:none; }
    #bizbot-send { background:linear-gradient(135deg,#00d4ff,#7b2ff7); color:#fff; border:none; border-radius:50%; width:36px; height:36px; margin-left:8px; cursor:pointer; font-size:16px; flex-shrink:0; }
    @media(max-width:480px){#bizbot-chat{width:calc(100vw-40px);right:-10px;height:60vh;}}
  \`;
  document.head.appendChild(style);
  
  // HTML
  var wrapper = document.createElement("div");
  wrapper.id = "bizbot-widget";
  wrapper.innerHTML = \`
    <div id="bizbot-chat">
      <div id="bizbot-header">🤖 Support Bot</div>
      <div id="bizbot-messages">
        <div class="bizbot-msg bot">👋 Hi! I am your AI support bot. Ask me anything about our product!</div>
      </div>
      <div id="bizbot-input-wrap">
        <input id="bizbot-input" type="text" placeholder="Ask a question..." />
        <button id="bizbot-send">➤</button>
      </div>
    </div>
    <button id="bizbot-toggle">💬</button>
  \`;
  document.body.appendChild(wrapper);
  
  // Logic
  var toggle = document.getElementById("bizbot-toggle");
  var chat = document.getElementById("bizbot-chat");
  var input = document.getElementById("bizbot-input");
  var send = document.getElementById("bizbot-send");
  var messages = document.getElementById("bizbot-messages");
  
  toggle.onclick = function() { chat.classList.toggle("open"); };
  
  function addMessage(text, type) {
    var div = document.createElement("div");
    div.className = "bizbot-msg " + type;
    div.textContent = text;
    messages.appendChild(div);
    messages.scrollTop = messages.scrollHeight;
  }
  
  async function sendMessage() {
    var text = input.value.trim();
    if (!text) return;
    addMessage(text, "user");
    input.value = "";
    
    try {
      var res = await fetch(server + "/chat", {
        method: "POST",
        headers: {"Content-Type":"application/json"},
        body: JSON.stringify({message:text})
      });
      var data = await res.json();
      addMessage(data.answer, "bot");
    } catch(e) {
      addMessage("Sorry, the chatbot server is not reachable. Make sure bizbot serve is running.", "bot");
    }
  }
  
  send.onclick = sendMessage;
  input.onkeydown = function(e) { if(e.key==="Enter") sendMessage(); };
})();
`;
}

module.exports = { ingest, serve, buildWidget, search, generateAnswer };