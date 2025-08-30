import { messages } from '@/db/schema';
import { CoreSystemMessage, CoreUserMessage, CoreAssistantMessage, CoreToolMessage, UIMessage, generateText } from 'ai';
import { generateSystemPrompt } from './prompts';
import { getAITools } from './tools';
import { ChatGoogle } from "@langchain/google-gauth";

import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { HumanMessage, AIMessage, ToolMessage, SystemMessage } from '@langchain/core/messages';


export const executeAgent = async (msgs: (typeof messages.$inferSelect & {sender_type?: string})[] , customerId: string, connectedPageID: string, businessDescription: string | null, businessId: string, address: string, customerInfo: string, replyUserFn: (message: string) => Promise<void>, replyUserWithProductImageAndInfoFn: (productImageURL: string, productInfo: string) => Promise<void>, log: (message: string) => void) => {

  const messages: (HumanMessage | AIMessage | ToolMessage | SystemMessage)[] = []
  let totalOutPutToken = 0;

  const systemPromptContent = generateSystemPrompt(businessDescription);
  messages.push(new SystemMessage(systemPromptContent));

  for (const msg of msgs) {
    console.log(msg)
    if (msg.senderType === "CUSTOMER" || msg.sender_type === "CUSTOMER") {
      messages.push(new HumanMessage(msg.content));
    } else if (msg.senderType === "BOT" || msg.sender_type === "BOT") {
      messages.push(new AIMessage(msg.content));
    }
  }

  const {
    getProductByShortTag,
    getProductsByImageURL,
    calculator,
    createProduct,
    getProductByKeyword,
    getProductByKeywordWithMaxPrice,
    getProductByKeywordWithMinPrice,
    createOrder,
    updateOrderInfo,
    replyUser,
    replyUserWithProductImageAndInfo
  } = getAITools(customerId, connectedPageID, businessId, address, replyUserFn, replyUserWithProductImageAndInfoFn);

  log("Before calling AI, last 3 messages with sender: ");
  const last3Messages = messages.slice(-3);
  for (const msg of last3Messages) {
    log(`Sender: ${msg._getType}, Message: ${msg.content}`);
  }

  const model = new ChatGoogle({
    model: "gemini-2.5-flash-lite",
    apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY,
    temperature: 0.2,
    maxReasoningTokens: 512,
  });

  const llmWithTools = model.bindTools([
    getProductByShortTag,
    getProductsByImageURL,
    calculator,
    createProduct,
    getProductByKeyword,
    createOrder,
    updateOrderInfo,
    replyUser,
    replyUserWithProductImageAndInfo
  ],
    { tool_choice: "any" }
  );

  const aiMessagex = await llmWithTools.invoke(messages);

  log("AI response received: " + JSON.stringify(aiMessagex.content));
  log("Input Token: " + aiMessagex.usage_metadata?.input_tokens);
  log("Output Token: " + aiMessagex.usage_metadata?.output_tokens);
  totalOutPutToken += aiMessagex.usage_metadata?.output_tokens || 0;
  log("Total Token: " + aiMessagex.usage_metadata?.total_tokens);
  log("Total Output Token so far: " + totalOutPutToken);
  log("Checking for any tool calls...");
  messages.push(aiMessagex);

  const toolsByName = {
    getProductByShortTag,
    getProductsByImageURL,
    calculator,
    createProduct,
    getProductByKeyword,
    createOrder,
    updateOrderInfo,
    replyUser,
    replyUserWithProductImageAndInfo
  };

  async function processMsg(aiMessage: AIMessage) {

    // Check if tool_calls exist, is an array, and has elements
    if (aiMessage.tool_calls && Array.isArray(aiMessage.tool_calls) && aiMessage.tool_calls.length > 0) {
      for (const toolCall of aiMessage.tool_calls) {
        // Ensure toolCall has 'name' and 'id' properties. LangChain tool_calls should have these.
        if (!toolCall.name || typeof toolCall.id === 'undefined') {
          log("Skipping malformed tool_call (missing name or id): " + JSON.stringify(toolCall));
          // Optionally, push a ToolMessage indicating this malformed call if needed for the LLM to react.
          // For now, just skipping.
          continue;
        }


        const toolName = toolCall.name as keyof typeof toolsByName;
        const selectedTool = toolsByName[toolName];
        // if (toolName == 'replyUser') {
        //   log(`Tool name is 'replyUser', returning message: ${toolCall.args?.msg}`);
        //   return toolCall!.args!.msg;


        // }
        if (selectedTool) {
          try {
            log(`Invoking tool: ${toolName} with args: ${JSON.stringify(toolCall.args)}`);
            // Perform a more specific cast on selectedTool or its invoke method
            // This tells TypeScript to trust that 'selectedTool' is a callable function
            // with an 'invoke' method that can accept 'toolCall.args'.
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const toolFn = selectedTool as { invoke: (args: any) => Promise<any> };
            const toolResultData = await toolFn.invoke(toolCall.args);
            log(typeof toolResultData === 'string' ? toolResultData : JSON.stringify(toolResultData));
            // Construct ToolMessage correctly for LangChain
            if (toolName == 'replyUser' || toolName == 'replyUserWithProductImageAndInfo') {
              log(`Tool name is 'replyUser', returning message: ${toolCall.args?.msg}`);
              return "";
            }

            messages.push(new ToolMessage({
              content: typeof toolResultData === 'string' ? toolResultData : JSON.stringify(toolResultData),
              tool_call_id: toolCall.id, // Use toolCall.id from the AI's tool_call object
            }));
          } catch (error) {
            console.log(error)
            log(`Error invoking tool ${toolName}: ${(error as Error).message}`);
            messages.push(new ToolMessage({
              content: `Error executing tool ${toolName}: ${(error as Error).message}`,
              tool_call_id: toolCall.id,
            }));
          }
        } else {
          log(`Tool ${toolName} not found.`);
          messages.push(new ToolMessage({
            content: `Tool ${toolName} not found.`,
            tool_call_id: toolCall.id,
          }));
        }
      }

      // log("Messages after tool processing: " + JSON.stringify(messages));
      // If tools were called, invoke the LLM again with the updated messages array.
      // The 'messages' array now contains: HumanMessage, AIMessage (with tool_calls), and ToolMessages.
      const finalAiResponse = await llmWithTools.invoke(messages);
      log("After Tool Call AI response: " + JSON.stringify(finalAiResponse.content));
      log("Input Token: " + finalAiResponse.usage_metadata?.input_tokens);
      log("Output Token: " + finalAiResponse.usage_metadata?.output_tokens);
      totalOutPutToken += finalAiResponse.usage_metadata?.output_tokens || 0;
      log("Total Token: " + finalAiResponse.usage_metadata?.total_tokens);
      log("Total Output Token so far: " + totalOutPutToken);
      log("Checking for any tool calls...");
      messages.push(finalAiResponse);
      return (await processMsg(finalAiResponse)); // Return content of the final AI response
    } else {
      // No tool calls were made in the initial AI response, or tool_calls array was empty/malformed.
      // Return the content of the initial aiMessage.
      log("No tool calls made or tool_calls empty/malformed. Returning initial AI content.");
      log("Final generated content to return: " + JSON.stringify(aiMessage.content));
      return aiMessage.content;
    }
  }
  return (await processMsg(aiMessagex));

};

