import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { URL } from "url"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import { LoggingMessageNotificationSchema, ToolListChangedNotificationSchema, TextContentSchema } from "@modelcontextprotocol/sdk/types.js"
// This line imports and configures dotenv, loading variables from your .env file into process.env
import 'dotenv/config';

// Define the environment variable key for clarity
const SERVER_URL_ENV_KEY = 'MCP_SERVER_URL';
const TOOLS_TO_CALL_ENV_KEY = 'TOOLS_TO_CALL';

// 1. Determine the server URL based on priority: Command Line Arg > Environment Var > Default
// Command line arguments start at index 2 (process.argv[2])
const cmdArgUrl = process.argv[2];
const envUrl = process.env[SERVER_URL_ENV_KEY];
// The original hardcoded URL is now the ultimate default
const defaultUrl = "https://mcp-health-node-v1-770535842811.us-east1.run.app/mcp";

const serverUrl = cmdArgUrl || envUrl || defaultUrl;

if (cmdArgUrl) {
    console.log(`[INFO] Using URL from Command Line Argument: ${serverUrl}`);
} else if (envUrl) {
    console.log(`[INFO] Using URL from Environment Variable (${SERVER_URL_ENV_KEY}): ${serverUrl}`);
} else {
    console.warn(`[WARNING] Neither command line argument nor environment variable ${SERVER_URL_ENV_KEY} is set. Using default URL: ${serverUrl}`);
}

let toolsToCall: string[] = [];
const toolsToCallEnv = process.env[TOOLS_TO_CALL_ENV_KEY];

if (toolsToCallEnv) {
    // Split by comma, trim whitespace, and filter out any empty strings
    toolsToCall = toolsToCallEnv.split(',')
        .map(tool => tool.trim())
        .filter(tool => tool.length > 0);
    
    if (toolsToCall.length > 0) {
        console.log(`[INFO] Only calling specified tools from ENV: ${toolsToCall.join(', ')}`);
    }
} else {
    console.log(`[INFO] ${TOOLS_TO_CALL_ENV_KEY} environment variable not set. Will call all discovered tools.`);
}

class MCPClient {
    tools: {name: string, description: string}[] = []

    private client: Client
    private transport: StreamableHTTPClientTransport | null = null
    private isCompleted = false

    constructor(serverName: string) {
        this.client = new Client({ name: `mcp-client-for-${serverName}`, version: "1.0.0" })
    }

    async connectToServer(serverUrl: string) {
        const url = new URL(serverUrl)
        try {
            this.transport = new StreamableHTTPClientTransport(url)
            await this.client.connect(this.transport)
            console.log("Connected to server")

            this.setUpTransport()
            this.setUpNotifications()
        } catch (e) {
            console.log("Failed to connect to MCP server: ", e)
            throw e
        }
    }

    async listTools() {
        try {
            const toolsResult = await this.client.listTools()
            console.log('Available tools:', toolsResult.tools)
            this.tools = toolsResult.tools.map((tool) => {
                return {
                    name: tool.name,
                    description: tool.description ?? "",
                }
            })
        } catch (error) {
            console.log(`Tools not supported by the server (${error})`);
        }
    }

    async callTool(name: string) {
        try {
            console.log('\nCalling tool: ', name);

            const result  = await this.client.callTool({
                name: name,
                arguments: { name: "itsuki"},
            })

            const content = result.content as object[]

            console.log('results:');
            content.forEach((item) => {
                const parse = TextContentSchema.safeParse(item)
                if (parse.success) {
                    console.log(`- ${parse.data.text}`);
                }
            })
        } catch (error) {
            console.log(`Error calling greet tool: ${error}`);
        }

    }

    // Set up notification handlers for server-initiated messages
    private setUpNotifications() {
        this.client.setNotificationHandler(LoggingMessageNotificationSchema, (notification) => {
            console.log("LoggingMessageNotificationSchema received:  ", notification)
        })
        // will only be triggered after list tools called
        this.client.setNotificationHandler(ToolListChangedNotificationSchema, async (notification) => {
            console.log("ToolListChangedNotificationSchema received:  ", notification)
            await this.listTools()
        })
    }

    private setUpTransport() {
        if (this.transport === null) {
            return
        }
        this.transport.onclose = () => {
            console.log("SSE transport closed.")
            this.isCompleted = true
        }

        this.transport.onerror = async (error) => {
            console.log("SSE transport error: ", error)
            await this.cleanup()
        }
    }

    async waitForCompletion() {
        while (!this.isCompleted) {
            await new Promise(resolve => setTimeout(resolve, 100));
        }
    }

    async cleanup() {
        await this.client.close()
    }
}

async function main() {
    const client = new MCPClient("sse-server")

    try {
        await client.connectToServer(serverUrl) // Uses the determined serverUrl variable
        await client.listTools()
        let toolsToExecute = client.tools;
        // limiting the tools to exec/call to the ones set in .env set TOOLS_TO_CALL_ENV_KEY
        if (toolsToCall.length > 0) {
            // Filter the available tools by the requested names from the environment variable
            const requestedToolNames = toolsToCall.map(name => name.toLowerCase());

            toolsToExecute = client.tools.filter(tool => 
                requestedToolNames.includes(tool.name.toLowerCase())
            );
            
            if (toolsToExecute.length < toolsToCall.length) {
                const foundNames = toolsToExecute.map(t => t.name.toLowerCase());
                const notFound = toolsToCall.filter(name => !foundNames.includes(name.toLowerCase()));
                console.warn(`[WARNING] The following requested tools were not found on the server: ${notFound.join(', ')}`);
            }
        }
         if (toolsToExecute.length === 0) {
            console.log("No tools selected or found to execute. Exiting tool calling loop.");
        } else {
            console.log(`Executing ${toolsToExecute.length} tool(s).`);
            for (const tool of toolsToExecute) {
                await client.callTool(tool.name)
            }
        }
        // console.log("waitForCompletion...")
        // await client.waitForCompletion()
    } finally {
        await client.cleanup()
    }
}

main()
