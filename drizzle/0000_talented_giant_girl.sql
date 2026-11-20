CREATE TYPE "public"."transaction_status" AS ENUM('pending', 'success', 'failed', 'abandoned', 'reversed');--> statement-breakpoint
CREATE TABLE "customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(255) NOT NULL,
	"name" text,
	"paystack_customer_code" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customers_email_unique" UNIQUE("email"),
	CONSTRAINT "customers_paystack_customer_code_unique" UNIQUE("paystack_customer_code")
);
--> statement-breakpoint
CREATE TABLE "transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reference" varchar(100) NOT NULL,
	"customer_id" uuid NOT NULL,
	"amount" integer NOT NULL,
	"currency" varchar(3) DEFAULT 'NGN' NOT NULL,
	"status" "transaction_status" DEFAULT 'pending' NOT NULL,
	"message" text,
	"is_anonymous" boolean DEFAULT false NOT NULL,
	"paystack_access_code" varchar(100),
	"channel" varchar(50),
	"paid_at" timestamp with time zone,
	"paystack_data" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transactions_reference_unique" UNIQUE("reference"),
	CONSTRAINT "transactions_amount_positive" CHECK ("transactions"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "webhook_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_key" varchar(200) NOT NULL,
	"event" varchar(100) NOT NULL,
	"reference" varchar(100),
	"payload" jsonb NOT NULL,
	"processed_at" timestamp with time zone,
	"error" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "webhook_events_event_key_unique" UNIQUE("event_key")
);
--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "transactions_customer_id_idx" ON "transactions" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "transactions_status_idx" ON "transactions" USING btree ("status");