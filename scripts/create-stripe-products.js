const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

async function main() {
  const plans = [
    {
      name: 'Basic',
      monthly: 9700, // in cents (R$ 97.00)
      annual: 97000,  // in cents (R$ 970.00 - 2 months free)
    },
    {
      name: 'Pro',
      monthly: 19700, // in cents (R$ 197.00)
      annual: 197000,  // in cents (R$ 1.970.00 - 2 months free)
    },
    {
      name: 'Enterprise',
      monthly: 49700, // in cents (R$ 497.00)
      annual: 497000,  // in cents (R$ 4.970.00 - 2 months free)
    },
  ];

  console.log('Criando produtos e preços recorrentes na Stripe...');

  for (const plan of plans) {
    const product = await stripe.products.create({
      name: `Plano ${plan.name} - Kivoni`,
      description: `Assinatura recorrente do plano ${plan.name} do Kivoni`,
    });

    const monthlyPrice = await stripe.prices.create({
      product: product.id,
      unit_amount: plan.monthly,
      currency: 'brl',
      recurring: {
        interval: 'month',
        usage_type: 'licensed',
      },
    });

    const annualPrice = await stripe.prices.create({
      product: product.id,
      unit_amount: plan.annual,
      currency: 'brl',
      recurring: {
        interval: 'year',
        usage_type: 'licensed',
      },
    });

    console.log(`\n========================================`);
    console.log(`PLANO: ${plan.name.toUpperCase()}`);
    console.log(`ID do Produto: ${product.id}`);
    console.log(`Mensal (R$ ${plan.monthly/100}/mês): ${monthlyPrice.id}`);
    console.log(`Anual (R$ ${plan.annual/100}/ano): ${annualPrice.id}`);
  }
}

main().catch(err => {
  console.error('Erro ao criar produtos na Stripe:', err);
  process.exit(1);
});
