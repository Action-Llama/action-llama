/**
 * Unit test for credentials/builtins/discord-bot.ts
 *
 * Verifies the Discord bot credential definition has the expected shape.
 */
import { describe, it, expect } from "vitest";
import discordBot from "../../../src/credentials/builtins/discord-bot.js";

describe("discord-bot credential definition", () => {
  it("has id 'discord_bot'", () => {
    expect(discordBot.id).toBe("discord_bot");
  });

  it("has fields: application_id, public_key, bot_token", () => {
    const fieldNames = discordBot.fields.map((f) => f.name);
    expect(fieldNames).toContain("application_id");
    expect(fieldNames).toContain("public_key");
    expect(fieldNames).toContain("bot_token");
  });

  it("marks bot_token as secret", () => {
    const botToken = discordBot.fields.find((f) => f.name === "bot_token");
    expect(botToken?.secret).toBe(true);
  });

  it("marks application_id as non-secret", () => {
    const appId = discordBot.fields.find((f) => f.name === "application_id");
    expect(appId?.secret).toBe(false);
  });

  it("has envVars for all fields", () => {
    expect(discordBot.envVars).toBeDefined();
    expect(discordBot.envVars!.application_id).toBe("DISCORD_APPLICATION_ID");
    expect(discordBot.envVars!.public_key).toBe("DISCORD_PUBLIC_KEY");
    expect(discordBot.envVars!.bot_token).toBe("DISCORD_BOT_TOKEN");
  });

  it("has a helpUrl", () => {
    expect(discordBot.helpUrl).toContain("discord.com");
  });
});
