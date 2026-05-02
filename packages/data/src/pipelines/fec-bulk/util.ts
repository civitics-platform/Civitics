import * as fs       from "fs";
import * as path     from "path";
import * as unzipper from "unzipper";

/**
 * Extract a single entry from a zip file to disk via pipe (streaming — no full-buffer materialization).
 * Returns true if the entry was found, false if not.
 */
export async function extractZipEntryToDisk(
  zipPath:   string,
  matchName: (name: string) => boolean,
  destPath:  string,
): Promise<boolean> {
  return new Promise((resolve, reject) => {
    let found = false;

    fs.createReadStream(zipPath)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .pipe((unzipper as any).Parse())
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .on("entry", (entry: any) => {
        const name = path.basename(entry.path as string).toLowerCase();
        if (!found && matchName(name)) {
          found = true;
          const out = fs.createWriteStream(destPath);
          entry.pipe(out);
          out.on("finish", () => resolve(true));
          out.on("error", reject);
        } else {
          entry.autodrain();
        }
      })
      .on("finish", () => { if (!found) resolve(false); })
      .on("error", reject);
  });
}

/** Convert FEC date "MMDDYYYY" → ISO "YYYY-MM-DD". Returns null if invalid. */
export function parseFecDate(mmddyyyy: string): string | null {
  if (!mmddyyyy || mmddyyyy.length !== 8) return null;
  const mm   = mmddyyyy.slice(0, 2);
  const dd   = mmddyyyy.slice(2, 4);
  const yyyy = mmddyyyy.slice(4, 8);
  if (!/^\d+$/.test(mm + dd + yyyy)) return null;
  return `${yyyy}-${mm}-${dd}`;
}
