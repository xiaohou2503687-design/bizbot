#!/usr/bin/env node
const { program } = require("commander");
const { ingest, serve, buildWidget } = require("../src/index");
const path = require("path");

program
  .name("bizbot")
  .description("🤖 AI customer support chatbot — embed one script")
  .version("0.1.0");

program
  .command("ingest")
  .description("Ingest docs/FAQ for the chatbot knowledge base")
  .argument("<path>", "Path to docs folder or file")
  .option("-n, --name <name>", "Bot name", "Support Bot")
  .option("-o, --output <path>", "Output knowledge base path", "./bizbot-data")
  .action(async (inputPath, options) => {
    try {
      const result = await ingest(inputPath, options);
      console.log(`✅ Ingested ${result.docCount} documents into ${result.outputPath}`);
      console.log(`   Run "bizbot serve" to start the chatbot server`);
      process.exit(0);
    } catch (err) {
      console.error("Error:", err.message);
      process.exit(1);
    }
  });

program
  .command("serve")
  .description("Start the chatbot server")
  .option("-p, --port <port>", "Port number", "3456")
  .option("-d, --data <path>", "Knowledge base path", "./bizbot-data")
  .option("--api-key <key>", "OpenAI API key for AI responses (optional)")
  .action(async (options) => {
    try {
      await serve(options);
    } catch (err) {
      console.error("Error:", err.message);
      process.exit(1);
    }
  });

program
  .command("widget")
  .description("Generate embeddable widget script")
  .option("-o, --output <path>", "Output path", "./bizbot-widget.js")
  .option("--server <url>", "Chatbot server URL", "http://localhost:3456")
  .action(async (options) => {
    await buildWidget(options);
    process.exit(0);
  });

program.parse();