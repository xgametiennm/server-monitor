declare module '@xterm/xterm' {
  export class Terminal {
    constructor(options?: any);
    open(parent: HTMLElement): void;
    write(data: string): void;
    writeln(data: string): void;
    onData(callback: (data: string) => void): void;
    loadAddon(addon: any): void;
    dispose(): void;
  }
}

declare module '@xterm/addon-fit' {
  export class FitAddon {
    constructor();
    fit(): void;
    activate(terminal: any): void;
    dispose(): void;
  }
}
