import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { ChatOpenAI } from "@langchain/openai";

function getGmiEnv() {
  const apiKey = process.env.GMI_API_KEY;
  if (!apiKey) {
    throw new Error("GMI_API_KEY is not set in the environment.");
  }
  const baseURL =
    process.env.GMI_BASE_URL ?? "https://api.gmi-serving.com/v1";
  const model =
    process.env.GMI_VISION_MODEL ??
    process.env.GMI_MODEL ??
    "gmi/openai/gpt-4o-mini";
  return { apiKey, baseURL, model };
}


/** Chat model for text + vision (OpenAI-style multimodal messages). */
export function createGmiChatModel(modelOverride?: string): ChatOpenAI {
  const { apiKey, baseURL, model } = getGmiEnv();
  return new ChatOpenAI({
    model: modelOverride ?? model,
    apiKey,
    configuration: { baseURL },
  });
}

function stringifyContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((block) => {
        if (typeof block === "object" && block !== null && "text" in block) {
          return String((block as { text?: string }).text ?? "");
        }
        return "";
      })
      .join("");
  }
  return String(content ?? "");
}

/**
 * Vision call: image as data URL + optional user caption (iMessage body text).
 */
export async function analyzeImageWithGmi(input: {
  base64: string;
  mimeType: string;
  userCaption: string | null;
}): Promise<string> {
  const model = createGmiChatModel();
  const caption = input.userCaption?.trim();
  const prompt = caption
    ? `The user sent this image with the message: "${caption}". Describe what you see and answer helpfully. Be concise.`
    : "Describe what you see in this image. If it looks like a document or receipt, summarize key fields. Be concise.";

  const human = new HumanMessage({
    content: [
      { type: "text", text: prompt },
      {
        type: "image_url",
        image_url: {
          url: `data:${input.mimeType};base64,${input.base64}`,
        },
      },
    ],
  });

  const res = await model.invoke([
    new SystemMessage(
      "You are a helpful assistant for iMessage. The user may send photos of documents or screenshots.",
    ),
    human,
  ]);

  return stringifyContent(res.content);
}
