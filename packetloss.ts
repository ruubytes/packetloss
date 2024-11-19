interface ResultNode {
  success: boolean;
  next: ResultNode | null;
}

interface Website {
  url: string;
  total: number;
  failed: number;
}

// TODO: remove websites from ping list if they fail >~1.5 times compared to the rest.
// TODO: Re-use cut off linked list head instead of garbage collecting it.
const main = () => {
  const websites = [
    // Search Engines
    { url: "google.com", total: 0, failed: 0 },
    { url: "bing.com", total: 0, failed: 0 },
    { url: "yahoo.com", total: 0, failed: 0 },
    { url: "duckduckgo.com", total: 0, failed: 0 },
    // Tech Companies
    { url: "microsoft.com", total: 0, failed: 0 },
    { url: "apple.com", total: 0, failed: 0 },
    { url: "amazon.com", total: 0, failed: 0 },
    { url: "aws.amazon.com", total: 0, failed: 0 },
    // Public DNS Servers
    { url: "1.1.1.1", total: 0, failed: 0 },
    { url: "8.8.8.8", total: 0, failed: 0 },
    { url: "9.9.9.9", total: 0, failed: 0 },
    { url: "208.67.222.222", total: 0, failed: 0 },
    // Languages
    { url: "python.org", total: 0, failed: 0 },
    { url: "go.dev", total: 0, failed: 0 },
    { url: "ruby-lang.org", total: 0, failed: 0 },
    // Niche Sites
    { url: "myanimelist.net", total: 0, failed: 0 },
  ];
  const encoder: TextEncoder = new TextEncoder();
  const timeout: number | null = parseInt(Deno.args[0]) ?? null;
  const totalCountedPackets: number = parseInt(Deno.args[1]) ?? 1000;
  let lastSitePinged: string = "";
  let totalPackets: number = 0;
  let failedPackets: number = 0;
  let head: ResultNode | null = null;
  let tail: ResultNode | null = null;
  let isRunning: boolean = true;

  /**
   * Add a listener for `SIGINT` (Ctrl+C) to stop the packetloss monitoring and return a reference
   * to a function to remove the listener.
   * @returns A function reference to remove the shutdown listener at a later time.
   */
  const setupShutdownHandler = () => {
    const handler = () => {
      isRunning = false;
      console.log("\r\x1b[K⏹️  Exiting packetloss monitor.");
    };
    Deno.addSignalListener("SIGINT", handler);
    return () => Deno.removeSignalListener("SIGINT", handler);
  };

  /**
   * Clears the previous line, moves the cursor to the beginning, and writes current packetloss rate.
   * @returns {Promise<number>} The number of bytes written.
   */
  const writeStats = async (): Promise<number> => {
    const lossRate = ((failedPackets / totalPackets) * 100).toFixed(2);
    const total = totalPackets.toString().padStart(
      totalCountedPackets.toString().length,
      "0",
    );
    const lost = failedPackets.toString().padStart(
      totalCountedPackets.toString().length,
      "0",
    );
    const text = `🔄 Packetloss rate (${lost}/${total}): ${lossRate ?? 0}%`;
    return await Deno.stdout.write(encoder.encode(`\r\x1b[K${text}`));
  };

  /**
   * Pings a website and returns true if the ping was successful, otherwise false.
   * @param {string} website A domain name to ping.
   * @returns
   */
  const ping = async (website: Website): Promise<boolean> => {
    try {
      const cmd = Deno.build.os === "windows"
        ? ["ping", "-n", "1", "-w", "500", website.url]
        : ["fping", "-c", "1", "-t", "500", website.url];
      website.total++;
      const { success } = await new Deno.Command(cmd[0], { args: cmd.slice(1) })
        .output();
      if (!success) {
        website.failed++;
      }
      return success;
    } catch {
      website.failed++;
      return false;
    }
  };

  /**
   * Record the ping result in a fifo linked list, since only the first and last nodes are really
   * of interest.
   * @param {boolean} isSuccess A ping result.
   */
  const recordPacket = (isSuccess: boolean) => {
    if (!isSuccess) failedPackets++;

    // If the fifo linked list is empty, add the node as head.
    const node: ResultNode = { success: isSuccess, next: null };
    if (!head) {
      head = node;
      tail = node;
      return;
    }

    if (tail) {
      tail.next = node;
      tail = node;
    }

    // Once we reach the maximum number of packets we want to keep a record of, we remove the head
    // node and set the following node as the new head.
    if (totalPackets === totalCountedPackets) {
      if (head && !head.success) {
        failedPackets--;
      }
      head = head?.next || null;
    } else {
      totalPackets++;
    }
  };

  /**
   * Prints the final statistics to the console.
   */
  const printFinalStats = () => {
    console.log(
      `\r\x1b[K📋 Websites pinged:\n${
        websites.map((w) =>
          `${w.url.padEnd(16, " ")}: ${
            w.total.toString().padStart(4, " ")
          } pings, ${w.failed.toString().padStart(3, " ")} failed`
        ).join("\n")
      }`,
    );
    const lossRate = ((failedPackets / totalPackets) * 100).toFixed(2);
    const total = totalPackets.toString().padStart(
      totalCountedPackets.toString().length,
      "0",
    );
    const lost = failedPackets.toString().padStart(
      totalCountedPackets.toString().length,
      "0",
    );
    if ((failedPackets / totalPackets) * 100 < 3) {
      console.log(`✅ Packetloss rate (${lost}/${total}): ${lossRate}%`);
    } else {
      console.log(`⚠️ Packetloss rate (${lost}/${total}): ${lossRate}%`);
    }
  };

  const getWebsite = (): Website => {
    let website = websites[Math.floor(Math.random() * websites.length)];
    while (website.url === lastSitePinged)
      website = websites[Math.floor(Math.random() * websites.length)];
    lastSitePinged = website.url;
    return website;
  }

  const sleep = (ms: number = 500) =>
    new Promise((resolve) => setTimeout(resolve, ms));

  /**
   * Measures the packetloss rate by pinging a random website from the websites array.
   * The rate is printed to the console every second, overwriting the previous line.
   */
  const measurePacketloss = async () => {
    const removeShutdownHandler = setupShutdownHandler();
    const startTime: number = Date.now();
    const endTime: number | null = timeout
      ? startTime + (timeout * 1000)
      : null;
    try {
      while (isRunning) {
        if (endTime && Date.now() >= endTime) break;
        const pingTime = Date.now();
        const website: Website = getWebsite();
        const packetStatus: boolean = await ping(website);
        recordPacket(packetStatus);
        await writeStats();
        await sleep(Math.max(0, 500 - (Date.now() - pingTime)));
      }
    } finally {
      removeShutdownHandler();
      printFinalStats();
    }
  };

  return { measurePacketloss };
};

if (import.meta.main) {
  main().measurePacketloss().catch((e) => console.error(e));
}
