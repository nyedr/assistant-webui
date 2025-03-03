# Streaming Tests

This directory contains tests for the streaming functionality in the `streamChatMessage` function.

## Test Structure

The tests are organized into separate files by functionality:

1. **stream-chat-message.test.ts**: Core functionality tests for the `streamChatMessage` function, focusing on general streaming and error handling.

2. **text-protocol.test.ts**: Tests specific to the text protocol streaming functionality.

3. **data-protocol.test.ts**: Tests specific to the data protocol streaming functionality, which includes more structured data formats.

4. **tool-calls.test.ts**: Tests for tool call handling functionality, including streaming tool calls, tool results, and error handling.

5. **message-parts.test.ts**: Tests for message part structure generation and other aspects like state management, performance, and specialized functionality.

## Test Categories

The tests cover the following categories:

### I. General Streaming and Error Handling

- Basic streaming functionality
- Error handling (HTTP errors, network errors, etc.)
- Callback invocation (onResponse, onError, onFinish, etc.)
- Request parameter handling (headers, body, attachments)

### II. Text Protocol Streaming

- Text content accumulation
- Stream part callbacks
- Basic message field creation
- TextPart structure

### III. Data Protocol Streaming

- Different data types (text, reasoning, data, annotations)
- Stream part handling
- Message building from multiple parts
- Source and reasoning handling

### IV. Tool Call Handling

- Tool call detection and callback invocation
- Tool invocation structure construction
- Multiple tool call handling
- Tool call streaming with delta updates
- Tool call error handling

### V. Message Part Structure

- Mixed part type generation
- Part structure validation
- Part type content validation

### VI. State Management

- State consistency across stream chunks
- Data accumulation and merging
- Message updates during streaming

### VII. Performance

- Large stream handling
- Stream cancellation
- Message restoration on failure

## Running Tests

Run the tests with Vitest:

```bash
npx vitest run tests/streaming
```

Or run individual test files:

```bash
npx vitest run tests/streaming/stream-chat-message.test.ts
```

## Mock Architecture

The tests use mock implementations for:

1. `fetch` - To mock the HTTP requests
2. ReadableStream - To simulate stream responses
3. `generateUUID` - For predictable ID generation
4. AbortController - For testing stream cancellation

Helper functions are provided to create mock streams, responses, and data chunks.
