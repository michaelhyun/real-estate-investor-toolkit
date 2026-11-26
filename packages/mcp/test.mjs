/* Starts the built server, speaks MCP to it over stdio, and checks that every
   tool answers with numbers the engine's own tests already vouch for. */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const here = dirname(fileURLToPath(import.meta.url));
const client = new Client({ name: 'test', version: '0' });
await client.connect(new StdioClientTransport({ command: 'node', args: [resolve(here, 'dist/investor-toolkit-mcp.mjs')] }));
const call = async (name, args) => {
  const r = await client.callTool({ name, arguments: args });
  assert.ok(!r.isError, `${name}: ${JSON.stringify(r.content)}`);
  return JSON.parse(r.content[0].text);
};

const tools = (await client.listTools()).tools.map(t => t.name).sort();
assert.deepEqual(tools, ['analyze_flip', 'analyze_rental', 'income_tax', 'list_bay_area_cities', 'mortgage_payment',
  'portfolio_summary', 'real_estate_professional_value', 'tax_brackets', 'tax_on_sale']);

const rental = await call('analyze_rental', { price: 250000, monthly_rent: 2000 });
assert.equal(rental.cash_needed.total, 66000);
assert.equal(rental.financing.new_loan, 200000);
assert.equal(rental.monthly.cash_flow, rental.monthly.net_operating_income - rental.monthly.debt_payment);

const mort = await call('mortgage_payment', { price: 350000, property_tax_yearly: 4200, insurance_yearly: 1600 });
assert.equal(mort.loan_amount, 280000);
assert.equal(mort.monthly_payment.total, 2346);

const flip = await call('analyze_flip', { purchase_price: 900000, arv: 1400000, rehab_budget: 180000, city: 'San Jose', square_feet: 1500 });
assert.equal(flip.scenarios.length, 3);
assert.ok(flip.city.includes('San Jose'));
assert.ok(flip.max_offer_for_min_profit > 0);

const household = { self_employment_profit: 320000, interest: 4000, ordinary_dividends: 9000, qualified_dividends: 7500,
  rental_net: -28000, deferral_401k: 24500, employer_401k: 46000, hsa: 8750, self_employed_health_insurance: 24000,
  mortgage_interest: 38000, property_tax: 16500, charitable: 8000, children_under_17: 2 };
const tax = await call('income_tax', household);
assert.equal(tax.total_tax, 49122);            /* the website's default household */
assert.equal(tax.california_tax, 6770);

const reps = await call('real_estate_professional_value', household);
assert.equal(reps.saving_this_year, 4812);
assert.equal(reps.with_election.california_tax, reps.without_election.california_tax);

const sale = await call('tax_on_sale', { ...household, long_term_gain: 500000 });
assert.equal(sale.total_tax_on_sale, 158004);
assert.equal(sale.federal.pushed_into_higher_bracket.new_bracket_pct, 20);
assert.equal(sale.federal.pushed_into_higher_bracket.income_past_the_line, 47896);

const br = await call('tax_brackets', { year: 2026, filing_status: 'mfj' });
assert.equal(br.federal_long_term_gains.length, 3);

const cities = await call('list_bay_area_cities', { county: 'Alameda' });
assert.ok(cities.length > 3 && cities.every(c => c.county === 'Alameda'));

const pf = await call('portfolio_summary', { properties: [
  { name: 'A', current_value: 820000, loan_balance: 455000, interest_rate: 3.5, monthly_payment: 2155, monthly_income: 5200,
    monthly_operating_expenses: 600, yearly_property_tax: 7800, yearly_insurance: 1900, down_payment: 120000, additional_cash_in: 30000 },
  { name: 'B', current_value: 520000, monthly_income: 2300, monthly_operating_expenses: 450, yearly_property_tax: 5000, yearly_insurance: 900, down_payment: 400000 },
] });
assert.equal(pf.totals.your_equity, 885000);
assert.deepEqual(pf.lazy_equity.properties, ['B']);

await client.close();
console.log(`ok: ${tools.length} tools, all checks passed`);
