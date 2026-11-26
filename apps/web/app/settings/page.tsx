'use client';

/* Settings: connect an AI agent to the toolkit.

   The toolkit ships an MCP server: one file that runs on your own computer
   and gives an agent (Claude, Cursor, anything that speaks MCP) the same
   calculators this site runs. This page is the download and the setup steps
   for each client. */

import { useState } from 'react';
import { Panel } from '../../components/calc';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Icon } from '../../components/Icon';
import { toast } from '../../components/toast';

const FILE = 'investor-toolkit-mcp.mjs';
const DOWNLOAD = `/mcp/${FILE}`;

const TOOLS: [string, string][] = [
  ['analyze_rental', 'Cash flow, cash-on-cash, cap rate, DSCR and a 5-year outlook for a rental.'],
  ['mortgage_payment', 'Monthly payment split, total interest, payoff time, and what extra principal saves.'],
  ['analyze_flip', 'Fix-and-flip profit, return on cash, peak cash, max offer and the 70% rule, with Bay Area city presets.'],
  ['list_bay_area_cities', 'The cities the flip analyzer has presets for, with tax rates and transfer tax custom.'],
  ['income_tax', 'Federal and California income tax, effective and marginal rates, line by line.'],
  ['tax_on_sale', 'What selling an asset adds to your tax, and whether it pushes you into a higher gains bracket.'],
  ['real_estate_professional_value', 'This year\'s tax with and without real estate professional status.'],
  ['tax_brackets', 'Federal and California brackets, standard deductions and the main thresholds.'],
  ['portfolio_summary', 'Equity, cash flow and return on equity across the rentals you own, with lazy-equity flags.'],
];

const json = (path: string) => `{
  "mcpServers": {
    "investor-toolkit": {
      "command": "node",
      "args": ["${path}"]
    }
  }
}`;

function Code({ children, label }: { children: string; label: string }) {
  const copy = async () => {
    try { await navigator.clipboard.writeText(children); toast('Copied'); }
    catch { toast('Copy failed. Select the text and copy it by hand'); }
  };
  return (
    <div className="relative my-2">
      <pre className="overflow-x-auto rounded-md bg-navy px-3.5 py-3 pr-12 text-[0.8125rem] leading-relaxed text-white/90"><code>{children}</code></pre>
      <Button variant="ghost" size="icon-sm" aria-label={`Copy ${label}`} title="Copy"
        className="absolute right-1.5 top-1.5 text-white/70 hover:bg-white/10 hover:text-white" onClick={copy}>
        <Icon name="content_copy" size={16} />
      </Button>
    </div>
  );
}

const Step = ({ n, title, children }: { n: number; title: string; children: React.ReactNode }) => (
  <li className="flex gap-3">
    <span className="grid size-6 shrink-0 place-items-center rounded-full bg-primary-tint text-xs font-bold text-primary-deep">{n}</span>
    <div className="min-w-0 flex-1 text-[0.9375rem] leading-snug text-[#3a4352]">
      <div className="font-bold text-ink-strong">{title}</div>
      {children}
    </div>
  </li>
);

export default function SettingsPage() {
  const [client, setClient] = useState('claude-code');
  const mac = '/Users/you/' + FILE, win = 'C:\\\\Users\\\\you\\\\' + FILE;

  return (
    <div className="max-w-3xl">
      <div className="mb-4">
        <h1 className="text-[1.75rem] font-extrabold leading-tight tracking-[-0.015em] text-ink-strong">Settings</h1>
        <p className="text-[0.9375rem] text-muted-foreground">Connect an AI agent to the toolkit.</p>
      </div>

      <div className="flex flex-col gap-4">
        <Panel title="Use the toolkit from an AI agent">
          <p className="text-[0.9375rem] leading-snug text-[#3a4352]">
            The toolkit comes with an MCP server: one small file that runs on your own computer and gives an agent
            the same calculators as this site. Ask it to underwrite a rental or price a sale, and it gets this
            site&apos;s numbers back.
          </p>
          <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-[0.8125rem] text-[#3a4352]">
            <li className="flex items-center gap-1.5"><Icon name="lock" size={16} className="text-success" />Runs on your computer</li>
            <li className="flex items-center gap-1.5"><Icon name="wifi_off" size={16} className="text-success" />Makes no network calls</li>
            <li className="flex items-center gap-1.5"><Icon name="folder_off" size={16} className="text-success" />Reads and saves no files</li>
          </ul>
        </Panel>

        <Panel title="Set it up">
          <ol className="flex flex-col gap-4 py-1">
            <Step n={1} title="Install Node.js 18 or newer">
              <p>Most developer machines have it. Check with <code className="rounded bg-muted px-1 py-0.5 text-[0.8125rem]">node --version</code>, or get it from{' '}
                <a href="https://nodejs.org" target="_blank" rel="noopener noreferrer" className="font-semibold text-primary hover:underline">nodejs.org</a>.</p>
            </Step>
            <Step n={2} title="Download the server">
              <p>Save it somewhere it can stay, such as your home folder.</p>
              <div className="mt-2 flex flex-wrap items-center gap-3">
                <Button nativeButton={false} render={<a href={DOWNLOAD} download={FILE} />}><Icon name="download" size={18} />Download {FILE}</Button>
                <span className="text-[0.8125rem] text-muted-foreground">One file, about 1 MB</span>
              </div>
              <p className="mt-2 text-[0.8125rem] text-muted-foreground">Or from a terminal:</p>
              <Code label="download command">{`curl -o ~/${FILE} https://tools.michaelhyunn.com${DOWNLOAD}`}</Code>
            </Step>
            <Step n={3} title="Add it to your agent">
              <Tabs value={client} onValueChange={v => setClient(String(v))} className="mt-2">
                <TabsList>
                  <TabsTrigger value="claude-code">Claude Code</TabsTrigger>
                  <TabsTrigger value="claude-desktop">Claude Desktop</TabsTrigger>
                  <TabsTrigger value="cursor">Cursor</TabsTrigger>
                  <TabsTrigger value="other">Other</TabsTrigger>
                </TabsList>
                <TabsContent value="claude-code" className="pt-2">
                  <p>Run this once. It adds the server for every project.</p>
                  <Code label="Claude Code command">{`claude mcp add --scope user investor-toolkit -- node ~/${FILE}`}</Code>
                  <p className="text-[0.8125rem] text-muted-foreground">Start a new session, then run <code className="rounded bg-muted px-1 py-0.5">/mcp</code> to confirm it shows as connected.</p>
                </TabsContent>
                <TabsContent value="claude-desktop" className="pt-2">
                  <p>Open Settings, then Developer, then Edit Config, and add this to <code className="rounded bg-muted px-1 py-0.5 text-[0.8125rem]">claude_desktop_config.json</code>. Use the full path to the file; <code className="rounded bg-muted px-1 py-0.5 text-[0.8125rem]">~</code> does not work here.</p>
                  <Code label="Claude Desktop config">{json(mac)}</Code>
                  <p className="text-[0.8125rem] text-muted-foreground">On Windows the path looks like <code className="rounded bg-muted px-1 py-0.5">{win}</code>. Quit and reopen Claude Desktop afterwards.</p>
                </TabsContent>
                <TabsContent value="cursor" className="pt-2">
                  <p>Add this to <code className="rounded bg-muted px-1 py-0.5 text-[0.8125rem]">~/.cursor/mcp.json</code>, or to <code className="rounded bg-muted px-1 py-0.5 text-[0.8125rem]">.cursor/mcp.json</code> inside one project.</p>
                  <Code label="Cursor config">{json(mac)}</Code>
                </TabsContent>
                <TabsContent value="other" className="pt-2">
                  <p>Any client that supports MCP over stdio works. Give it a server that runs this command:</p>
                  <Code label="server command">{`node /full/path/to/${FILE}`}</Code>
                  <p>Most clients take the same JSON shape:</p>
                  <Code label="generic config">{json('/full/path/to/' + FILE)}</Code>
                  <p className="text-[0.8125rem] text-muted-foreground">The server needs no API key, no environment variables and no arguments.</p>
                </TabsContent>
              </Tabs>
            </Step>
            <Step n={4} title="Try it">
              <p>Ask your agent something like:</p>
              <ul className="mt-1.5 flex flex-col gap-1.5">
                {[
                  'Underwrite a $650,000 duplex renting for $4,800 a month with 25% down at 6.75%.',
                  'What would I owe in tax if I sold a rental with a $400,000 long-term gain on top of $250,000 of self-employment income?',
                  'Is a flip in Oakland worth it at $900k purchase, $180k rehab and a $1.4M resale?',
                ].map(q => <li key={q} className="rounded-md bg-page px-3 py-2 text-sm italic">{q}</li>)}
              </ul>
            </Step>
          </ol>
        </Panel>

        <Panel title="What the agent can do" tag={`${TOOLS.length} tools`}>
          <ul>
            {TOOLS.map(([name, what]) => (
              <li key={name} className="flex flex-col gap-x-4 border-b border-line/60 py-2 last:border-b-0 sm:flex-row sm:items-baseline">
                <code className="shrink-0 text-[0.8125rem] font-semibold text-primary-deep sm:w-64">{name}</code>
                <span className="text-sm leading-snug text-[#3a4352]">{what}</span>
              </li>
            ))}
          </ul>
        </Panel>
      </div>

      <p className="mt-4 text-[0.8125rem] leading-snug text-muted-foreground">
        The server gives screening estimates, the same as this site. It is not tax, legal or lending advice.
        To update it, download the file again and replace the old one.
      </p>
    </div>
  );
}
