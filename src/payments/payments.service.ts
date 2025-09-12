import { Inject, Injectable, Logger } from '@nestjs/common';
import { NATS_SERVICE, envs } from 'src/config';
import Stripe from 'stripe';
import { PaymentSessionDto } from './dto/payment-session.dto';
import { Request, Response } from 'express';
import { ClientProxy } from '@nestjs/microservices';
import { lastValueFrom } from 'rxjs';

@Injectable()
export class PaymentsService {

  private readonly stripe = new Stripe(envs.stripeSecret);
  private readonly logger = new Logger('PaymentsService');

  constructor(
    @Inject(NATS_SERVICE) private readonly client: ClientProxy
  ) {}



  async createPaymentSession(paymentSessionDto: PaymentSessionDto) {
    const { currency, items, orderId } = paymentSessionDto;

    const lineItems = items.map((item) => {
      return {
        price_data: {
          currency: currency,
          product_data: {
            name: item.name,
          },
          unit_amount: Math.round(item.price * 100), // 20 dólares 2000 / 100 = 20.00 // 15.0000
        },
        quantity: item.quantity,
      };
    });

    const session = await this.stripe.checkout.sessions.create({
      // Colocar aquí el ID de mi orden
      payment_intent_data: {
        metadata: {
          orderId: orderId
        },
      },
      line_items: lineItems,
      mode: 'payment',
      success_url: envs.stripeSuccessUrl,
      cancel_url: envs.stripeCancelUrl,
    });

    // return session;
    return {
      cancelUrl: session.cancel_url,
      successUrl: session.success_url,
      url: session.url,
    }
  }
  

  async stripeWebhook(req: Request, res: Response) {
  const sig = req.headers['stripe-signature'] as string | undefined;
  if (!sig) {
    this.logger.error('Missing stripe-signature header');
    return res.status(400).send('Missing stripe-signature header');
  }

  const endpointSecret = envs.stripeEndpointSecret;
  if (!endpointSecret) {
    this.logger.error('Missing STRIPE_ENDPOINT_SECRET env var');
    return res.status(500).send('Server misconfiguration');
  }
  this.logger.log(`Stripe whsec loaded (...${endpointSecret.slice(-6)})`);

  let event: Stripe.Event;
  try {
    event = this.stripe.webhooks.constructEvent(
      req.body,
      //req['rawBody'],   // requiere app.use('/payments/webhook', raw({ type: 'application/json' }))
      sig,
      endpointSecret,
    );
  } catch (err: any) {
    this.logger.error(`Webhook signature verification failed: ${err.message}`);
    return res.status(400).send(`Webhook Error: ${err.message}`); // 👈 IMPORTANTE
  }

  this.logger.log(`Webhook OK: ${event.type}`);

  switch (event.type) {
 
    //Desde aqui
case 'charge.succeeded': {
  const ch = event.data.object as Stripe.Charge;

  let orderId   = ch.metadata?.orderId as string | undefined;
  let receiptUrl = ch.receipt_url as string | undefined;

  // Si no vino en el charge, recupéralo desde el Payment Intent
  if ((!orderId || !receiptUrl) && typeof ch.payment_intent === 'string') {
    // Trae el PI expandiendo latest_charge (no uses pi.charges)
    const piResp = await this.stripe.paymentIntents.retrieve(
      ch.payment_intent,
      { expand: ['latest_charge'] }
    );

    const pi = piResp as unknown as Stripe.PaymentIntent;

    // orderId desde metadata del PI (si faltaba)
    if (!orderId) orderId = pi.metadata?.orderId;

    // recibo desde latest_charge
    if (!receiptUrl) {
      if (typeof pi.latest_charge !== 'string' && pi.latest_charge) {
        receiptUrl = (pi.latest_charge as Stripe.Charge).receipt_url ?? undefined;
      } else if (typeof pi.latest_charge === 'string') {
        const latestCharge = await this.stripe.charges.retrieve(pi.latest_charge);
        receiptUrl = latestCharge.receipt_url ?? undefined;
      }
    }
  }

  if (!orderId) {
    this.logger.warn(`charge.succeeded sin orderId; no emito. charge=${ch.id}`);
    return res.status(200).json({ ok: true });
  }

  const payload = {
    stripePaymentId: ch.id,
    orderId,
    receiptUrl: receiptUrl ?? null,
  };

  this.logger.log(`Payload a emitir: ${JSON.stringify(payload)}`);
  await lastValueFrom(this.client.emit('payment.succeeded', payload));
  this.logger.log('Evento payment.succeeded emitido correctamente');
  break;

    // Hasta aqui
      
    }
    default:
      this.logger.warn(`Event ${event.type} not handled`);
  }

  return res.status(200).json({ ok: true });
}


}