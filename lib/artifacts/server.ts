export interface DataStream {
  writeData: (data: { type: string; content: string }) => void;
}

export interface DocumentHandlerOptions<T extends string> {
  kind: T;
  onCreateDocument: (params: {
    title: string;
    dataStream: DataStream;
  }) => Promise<string>;
  onUpdateDocument: (params: {
    document: { content: string };
    description: string;
    dataStream: DataStream;
  }) => Promise<string>;
}

export function createDocumentHandler<T extends string>(
  options: DocumentHandlerOptions<T>
) {
  return options;
}
