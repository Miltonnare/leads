/**
 * Generated-style Supabase PostgreSQL Database Types
 * Matches `schema.sql` tables, enums, and RPC functions for strict type safety.
 */

import type {
  DispatchChannel,
  DispatchMode,
  DispatchStatus,
  ExecutionMode,
  LeadStatus,
  WebhookProvider,
} from '@/core/domain';

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export interface Database {
  public: {
    Tables: {
      organizations: {
        Row: {
          id: string;
          slug: string;
          name: string;
          niche: string;
          contact_phone: string;
          owner_dialer_phone: string;
          dispatch_mode: DispatchMode;
          whatsapp_phone_number_id: string | null;
          whatsapp_access_token_encrypted: string | null;
          at_sender_id: string | null;
          primary_color: string;
          is_active: boolean;
          settings: Json;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          slug: string;
          name: string;
          niche?: string;
          contact_phone: string;
          owner_dialer_phone: string;
          dispatch_mode?: DispatchMode;
          whatsapp_phone_number_id?: string | null;
          whatsapp_access_token_encrypted?: string | null;
          at_sender_id?: string | null;
          primary_color?: string;
          is_active?: boolean;
          settings?: Json;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          slug?: string;
          name?: string;
          niche?: string;
          contact_phone?: string;
          owner_dialer_phone?: string;
          dispatch_mode?: DispatchMode;
          whatsapp_phone_number_id?: string | null;
          whatsapp_access_token_encrypted?: string | null;
          at_sender_id?: string | null;
          primary_color?: string;
          is_active?: boolean;
          settings?: Json;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      leads: {
        Row: {
          id: string;
          organization_id: string;
          raw_name: string;
          phone_e164: string;
          email: string | null;
          service_requested: string;
          estimated_value_kes: number | null;
          status: LeadStatus;
          execution_mode: ExecutionMode;
          first_response_latency_ms: number | null;
          db_latency_ms: number | null;
          owner_call_initiated_at: string | null;
          owner_clicked_call_at: string | null;
          owner_clicked_wa_at: string | null;
          customer_replied_at: string | null;
          metadata: Json;
          attribution: Json;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          raw_name: string;
          phone_e164: string;
          email?: string | null;
          service_requested: string;
          estimated_value_kes?: number | null;
          status?: LeadStatus;
          execution_mode?: ExecutionMode;
          first_response_latency_ms?: number | null;
          db_latency_ms?: number | null;
          owner_call_initiated_at?: string | null;
          owner_clicked_call_at?: string | null;
          owner_clicked_wa_at?: string | null;
          customer_replied_at?: string | null;
          metadata?: Json;
          attribution?: Json;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          raw_name?: string;
          phone_e164?: string;
          email?: string | null;
          service_requested?: string;
          estimated_value_kes?: number | null;
          status?: LeadStatus;
          execution_mode?: ExecutionMode;
          first_response_latency_ms?: number | null;
          db_latency_ms?: number | null;
          owner_call_initiated_at?: string | null;
          owner_clicked_call_at?: string | null;
          owner_clicked_wa_at?: string | null;
          customer_replied_at?: string | null;
          metadata?: Json;
          attribution?: Json;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      conversations: {
        Row: {
          id: string;
          lead_id: string;
          organization_id: string;
          channel: string;
          direction: string;
          external_message_id: string | null;
          message_body: string;
          delivery_status: string;
          raw_payload: Json | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          lead_id: string;
          organization_id: string;
          channel: string;
          direction: string;
          external_message_id?: string | null;
          message_body: string;
          delivery_status?: string;
          raw_payload?: Json | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          lead_id?: string;
          organization_id?: string;
          channel?: string;
          direction?: string;
          external_message_id?: string | null;
          message_body?: string;
          delivery_status?: string;
          raw_payload?: Json | null;
          created_at?: string;
        };
        Relationships: [];
      };
      lead_dispatches: {
        Row: {
          id: string;
          lead_id: string;
          channel: DispatchChannel;
          destination: string;
          provider_message_id: string | null;
          status: DispatchStatus;
          latency_ms: number | null;
          request_payload: Json;
          response_payload: Json | null;
          error_message: string | null;
          dispatched_at: string;
          acknowledged_at: string | null;
        };
        Insert: {
          id?: string;
          lead_id: string;
          channel: DispatchChannel;
          destination: string;
          provider_message_id?: string | null;
          status?: DispatchStatus;
          latency_ms?: number | null;
          request_payload?: Json;
          response_payload?: Json | null;
          error_message?: string | null;
          dispatched_at?: string;
          acknowledged_at?: string | null;
        };
        Update: {
          id?: string;
          lead_id?: string;
          channel?: DispatchChannel;
          destination?: string;
          provider_message_id?: string | null;
          status?: DispatchStatus;
          latency_ms?: number | null;
          request_payload?: Json;
          response_payload?: Json | null;
          error_message?: string | null;
          dispatched_at?: string;
          acknowledged_at?: string | null;
        };
        Relationships: [];
      };
      webhook_events: {
        Row: {
          id: string;
          provider: WebhookProvider;
          provider_message_id: string;
          status: string;
          lead_id: string | null;
          raw_payload: Json;
          processed_at: string;
        };
        Insert: {
          id?: string;
          provider: WebhookProvider;
          provider_message_id: string;
          status: string;
          lead_id?: string | null;
          raw_payload?: Json;
          processed_at?: string;
        };
        Update: {
          id?: string;
          provider?: WebhookProvider;
          provider_message_id?: string;
          status?: string;
          lead_id?: string | null;
          raw_payload?: Json;
          processed_at?: string;
        };
        Relationships: [];
      };
      audit_logs: {
        Row: {
          id: string;
          organization_id: string | null;
          action: string;
          actor_type: string;
          actor_id: string;
          details: Json;
          ip_address: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          organization_id?: string | null;
          action: string;
          actor_type: string;
          actor_id: string;
          details?: Json;
          ip_address?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string | null;
          action?: string;
          actor_type?: string;
          actor_id?: string;
          details?: Json;
          ip_address?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      ingest_lead_atomic: {
        Args: {
          p_org_slug: string;
          p_org_name: string;
          p_niche: string;
          p_primary_color: string;
          p_owner_phone: string;
          p_allow_auto_register: boolean;
          p_raw_name: string;
          p_phone_e164: string;
          p_email: string;
          p_service_requested: string;
          p_estimated_value_kes: number;
          p_execution_mode: ExecutionMode;
          p_metadata: Json;
          p_attribution: Json;
        };
        Returns: Json;
      };
      apply_webhook_event_atomic: {
        Args: {
          p_provider: WebhookProvider;
          p_provider_message_id: string;
          p_event_status: string;
          p_lead_target_status: LeadStatus | null;
          p_conversation_delivery_status: string | null;
          p_dispatch_status: DispatchStatus | null;
          p_raw_payload: Json;
        };
        Returns: Json;
      };
      record_owner_click_sla: {
        Args: {
          p_lead_id: string;
          p_channel: string;
          p_ip_address: string | null;
          p_user_agent: string | null;
        };
        Returns: Json | null;
      };
      check_rate_limit_sliding_window: {
        Args: {
          p_bucket_key: string;
          p_limit: number;
          p_window_seconds: number;
        };
        Returns: Json;
      };
    };
    Enums: {
      lead_status_enum: LeadStatus;
      dispatch_mode_enum: DispatchMode;
      execution_mode_enum: ExecutionMode;
      dispatch_channel_enum: DispatchChannel;
      dispatch_status_enum: DispatchStatus;
      webhook_provider_enum: WebhookProvider;
    };
    CompositeTypes: Record<string, never>;
  };
}
