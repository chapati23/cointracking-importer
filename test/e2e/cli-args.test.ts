import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const CLI_PATH = path.join(process.cwd(), "src/index.ts");
const TSX_PATH = "npx tsx";

function createTestFixtures(dir: string) {
  // Create native transactions CSV
  const nativeContent = `"Transaction Hash","DateTime (UTC)","From","To","Value_IN(MNT)","Value_OUT(MNT)","TxnFee(MNT)","Method"
"0xabc123","2024-12-04 12:00:00","0xsender","0xd8da6bf26964af9d7eed9e03e53415d37aa96045","100","0","0.001",""
"0xdef456","2024-12-04 13:00:00","0xd8da6bf26964af9d7eed9e03e53415d37aa96045","0xreceiver","0","50","0.002","Transfer"`;

  // Create token transfers CSV
  const tokensContent = `"Transaction Hash","DateTime (UTC)","From","To","TokenValue","TokenSymbol","TokenName","ContractAddress"
"0xtoken123","2024-12-04 14:00:00","0xd8da6bf26964af9d7eed9e03e53415d37aa96045","0xrouter","100","USDC","USD Coin","0xusdc"
"0xtoken123","2024-12-04 14:00:00","0xrouter","0xd8da6bf26964af9d7eed9e03e53415d37aa96045","0.05","WETH","Wrapped Ether","0xweth"`;

  fs.writeFileSync(path.join(dir, "native.csv"), nativeContent);
  fs.writeFileSync(path.join(dir, "tokens.csv"), tokensContent);
}

describe("CLI E2E Tests", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cli-e2e-test-"));
  });

  afterEach(() => {
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true });
    }
  });

  function runCli(
    args: string[],
    cwd: string = tempDir
  ): { stdout: string; stderr: string; exitCode: number } {
    try {
      const stdout = execSync(`${TSX_PATH} ${CLI_PATH} ${args.join(" ")} 2>&1`, {
        cwd,
        encoding: "utf8",
        env: { ...process.env, HOME: tempDir },
      });
      return { stdout, stderr: "", exitCode: 0 };
    } catch (error) {
      const err = error as { stdout?: string; stderr?: string; status?: number };
      return {
        stdout: err.stdout ?? "",
        stderr: err.stderr ?? "",
        exitCode: err.status ?? 1,
      };
    }
  }

  describe("convert command", () => {
    describe("with explicit file paths", () => {
      it("converts with all required args provided", () => {
        createTestFixtures(tempDir);
        const outputPath = path.join(tempDir, "output.csv");

        const result = runCli([
          "convert",
          `--address 0xd8da6bf26964af9d7eed9e03e53415d37aa96045`,
          `--chain Mantle`,
          `--nativeSymbol MNT`,
          `--native "${path.join(tempDir, "native.csv")}"`,
          `--tokens "${path.join(tempDir, "tokens.csv")}"`,
          `--output "${outputPath}"`,
        ]);

        expect(result.exitCode).toBe(0);
        expect(fs.existsSync(outputPath)).toBe(true);

        const content = fs.readFileSync(outputPath, "utf8");
        expect(content).toContain("Type,Buy Amount");
        expect(content).toContain("Deposit");
        expect(content).toContain("Trade");
      });

      it("supports --dry-run to preview without writing", () => {
        createTestFixtures(tempDir);
        const outputPath = path.join(tempDir, "output.csv");

        const result = runCli([
          "convert",
          `--address 0xd8da6bf26964af9d7eed9e03e53415d37aa96045`,
          `--chain Mantle`,
          `--nativeSymbol MNT`,
          `--native "${path.join(tempDir, "native.csv")}"`,
          `--tokens "${path.join(tempDir, "tokens.csv")}"`,
          `--output "${outputPath}"`,
          `--dry-run`,
        ]);

        expect(result.exitCode).toBe(0);
        expect(result.stdout).toContain("[Dry run]");
        // File should NOT be created in dry-run mode
        expect(fs.existsSync(outputPath)).toBe(false);
      });

      it("supports --verbose for detailed output", () => {
        createTestFixtures(tempDir);
        const outputPath = path.join(tempDir, "output.csv");

        const result = runCli([
          "convert",
          `--address 0xd8da6bf26964af9d7eed9e03e53415d37aa96045`,
          `--chain Mantle`,
          `--nativeSymbol MNT`,
          `--native "${path.join(tempDir, "native.csv")}"`,
          `--tokens "${path.join(tempDir, "tokens.csv")}"`,
          `--output "${outputPath}"`,
          `--verbose`,
        ]);

        expect(result.exitCode).toBe(0);
        expect(result.stdout).toContain("Native rows:");
        expect(result.stdout).toContain("Token rows:");
      });

      it("errors on non-existent file path", () => {
        const result = runCli([
          "convert",
          `--address 0xd8da6bf26964af9d7eed9e03e53415d37aa96045`,
          `--chain Mantle`,
          `--nativeSymbol MNT`,
          `--native "/nonexistent/native.csv"`,
        ]);

        // CLI exits with error when file doesn't exist
        // Error message can be in stdout or stderr depending on how the error is thrown
        const output = result.stdout + result.stderr;
        expect(output.toLowerCase()).toMatch(/error|not found|enoent/);
      });

      it("handles --cutoff date filter", () => {
        createTestFixtures(tempDir);
        const outputPath = path.join(tempDir, "output.csv");

        const result = runCli([
          "convert",
          `--address 0xd8da6bf26964af9d7eed9e03e53415d37aa96045`,
          `--chain Mantle`,
          `--nativeSymbol MNT`,
          `--native "${path.join(tempDir, "native.csv")}"`,
          `--tokens "${path.join(tempDir, "tokens.csv")}"`,
          `--output "${outputPath}"`,
          `--cutoff 2024-12-04`,
        ]);

        expect(result.exitCode).toBe(0);
        expect(fs.existsSync(outputPath)).toBe(true);
      });
    });

    describe("with --dir auto-detection", () => {
      it("auto-detects files in directory", () => {
        createTestFixtures(tempDir);
        const outputPath = path.join(tempDir, "output.csv");

        const result = runCli([
          "convert",
          `"${tempDir}"`,
          `--address 0xd8da6bf26964af9d7eed9e03e53415d37aa96045`,
          `--chain Mantle`,
          `--nativeSymbol MNT`,
          `--output "${outputPath}"`,
        ]);

        expect(result.exitCode).toBe(0);
        expect(fs.existsSync(outputPath)).toBe(true);
      });
    });
  });

  describe("list command", () => {
    it("shows empty history message when no imports", () => {
      const result = runCli(["list"]);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("No imports found");
    });
  });

  describe("mark-imported command", () => {
    it("errors on non-existent import ID", () => {
      const result = runCli(["mark-imported", "nonexistent-id"]);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("not found");
    });
  });

  describe("help command", () => {
    it("shows help with --help flag", () => {
      const result = runCli(["--help"]);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("convert");
      expect(result.stdout).toContain("ingest");
      expect(result.stdout).toContain("list");
      expect(result.stdout).toContain("mark-imported");
    });

    it("shows convert command help", () => {
      const result = runCli(["convert", "--help"]);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("--address");
      expect(result.stdout).toContain("--chain");
      expect(result.stdout).toContain("--nativeSymbol");
      expect(result.stdout).toContain("--native");
      expect(result.stdout).toContain("--tokens");
      expect(result.stdout).toContain("--dry-run");
      expect(result.stdout).toContain("--verbose");
    });
  });
});
