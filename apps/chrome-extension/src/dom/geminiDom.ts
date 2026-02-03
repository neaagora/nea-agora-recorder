export interface DomLocatorResult {
  messagesContainer: Element | null;
  messageNodes: Element[];
  userInput: HTMLTextAreaElement | HTMLElement | null;
  streamingIndicator: Element | null;
  methodUsed?: string;
}

export interface DomSignature {
  platform: string;
  selectorMethod?: string;
  messageCount: number;
  userInputFound: boolean;
  streamingIndicatorFound: boolean;
}

interface SelectorSpec {
  id: string;
  path: string;
}

const MESSAGE_SELECTORS: SelectorSpec[] = [
  { id: "structured", path: "structured-content-container" },
  { id: "message-content", path: "message-content" },
  { id: "response-content", path: ".response-content" },
];

const CONTAINER_SELECTORS: SelectorSpec[] = [
  { id: "main", path: "main" },
  { id: "role-main", path: '[role="main"]' },
];

const INPUT_SELECTORS: SelectorSpec[] = [
  { id: "rich-textarea", path: "rich-textarea" },
  { id: "role-textbox", path: '[role="textbox"]' },
  { id: "contenteditable", path: "[contenteditable='true']" },
];

function findAssistantMessages(): { nodes: Element[]; method?: string } {
  for (const spec of MESSAGE_SELECTORS) {
    const nodes = Array.from(document.querySelectorAll(spec.path));
    if (nodes.length > 0) {
      return { nodes, method: spec.id };
    }
  }
  return { nodes: [], method: undefined };
}

function findMainChatContainer(): Element | null {
  for (const spec of CONTAINER_SELECTORS) {
    const el = document.querySelector(spec.path);
    if (el) return el;
  }
  return document.body ?? null;
}

function findUserInputElement(): HTMLTextAreaElement | HTMLElement | null {
  for (const spec of INPUT_SELECTORS) {
    const el = document.querySelector(spec.path);
    if (el instanceof HTMLTextAreaElement) return el;
    if (el instanceof HTMLElement) return el;
  }
  return null;
}

function detectStreamingIndicator(): Element | null {
  const buttons = Array.from(document.querySelectorAll("button"));
  for (const btn of buttons) {
    const text = btn.textContent?.toLowerCase() ?? "";
    if (text.includes("stop")) {
      return btn;
    }
  }
  return null;
}

export function locateDomElements(): DomLocatorResult {
  const { nodes, method } = findAssistantMessages();
  const container = findMainChatContainer();
  const input = findUserInputElement();
  const streamingIndicator = detectStreamingIndicator();

  return {
    messagesContainer: container,
    messageNodes: nodes,
    userInput: input,
    streamingIndicator,
    methodUsed: method,
  };
}

export function buildDomSignature(
  result: DomLocatorResult,
  platform: string
): DomSignature {
  return {
    platform,
    selectorMethod: result.methodUsed,
    messageCount: result.messageNodes.length,
    userInputFound: !!result.userInput,
    streamingIndicatorFound: !!result.streamingIndicator,
  };
}

export function isDomSignatureBroken(signature: DomSignature): boolean {
  return (
    signature.messageCount === 0 &&
    !signature.userInputFound &&
    !signature.streamingIndicatorFound
  );
}
