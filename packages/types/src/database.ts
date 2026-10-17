// The slice of the database the web app may touch, taken from the Supabase type
// generator output for the hosted schema. Browsers never write tables (ADR 0002),
// so Insert/Update are `never`: a `.insert()` from apps/web fails to typecheck.
// Writes go through the RPCs listed under Functions. Add a table or RPC here
// only when the web app needs it, copying the generated shape.

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  __InternalSupabase: {
    PostgrestVersion: '14.18';
  };
  public: {
    Tables: {
      agent_turns: {
        Row: {
          answer: string;
          cited_source_ids: string[];
          created_at: string;
          deal_id: string;
          fund_id: string;
          id: number;
          input_tokens: number;
          model: string;
          output_tokens: number;
          question: string;
          user_id: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      audit_log: {
        Row: {
          action: string;
          actor: string | null;
          created_at: string;
          detail: Json;
          fund_id: string;
          id: number;
          target_id: string;
          target_table: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      companies: {
        Row: {
          country: string | null;
          created_at: string;
          fund_id: string;
          id: string;
          name: string;
          sector: string | null;
          updated_at: string;
          website: string | null;
        };
        Insert: never;
        Update: never;
        Relationships: [
          {
            foreignKeyName: 'companies_fund_id_fkey';
            columns: ['fund_id'];
            isOneToOne: false;
            referencedRelation: 'funds';
            referencedColumns: ['id'];
          },
        ];
      };
      deals: {
        Row: {
          company_id: string;
          created_at: string;
          fund_id: string;
          github_urls: string[];
          id: string;
          owner_id: string | null;
          pipeline: Json;
          round: string | null;
          status: Database['public']['Enums']['deal_status'];
          updated_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [
          {
            foreignKeyName: 'deals_company_id_fund_id_fkey';
            columns: ['company_id', 'fund_id'];
            isOneToOne: false;
            referencedRelation: 'companies';
            referencedColumns: ['id', 'fund_id'];
          },
          {
            foreignKeyName: 'deals_fund_id_fkey';
            columns: ['fund_id'];
            isOneToOne: false;
            referencedRelation: 'funds';
            referencedColumns: ['id'];
          },
        ];
      };
      funds: {
        Row: {
          allow_founder_self_assessment: boolean;
          created_at: string;
          id: string;
          name: string;
          plan: string;
          region: string;
          updated_at: string;
          weights: Json;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      memberships: {
        Row: {
          created_at: string;
          fund_id: string;
          role: string;
          updated_at: string;
          user_id: string;
        };
        Insert: never;
        Update: never;
        Relationships: [
          {
            foreignKeyName: 'memberships_fund_id_fkey';
            columns: ['fund_id'];
            isOneToOne: false;
            referencedRelation: 'funds';
            referencedColumns: ['id'];
          },
        ];
      };
    };
    Views: { [_ in never]: never };
    Functions: {
      create_deal: {
        Args: {
          p_company_name: string;
          p_country?: string;
          p_fund: string;
          p_github_urls?: string[];
          p_round?: string;
          p_sector?: string;
          p_website?: string;
        };
        Returns: string;
      };
    };
    Enums: {
      deal_status: 'screening' | 'diligence' | 'approved' | 'passed' | 'portfolio';
    };
    CompositeTypes: { [_ in never]: never };
  };
};

export type MemberRole = 'owner' | 'partner' | 'analyst' | 'viewer';
export type DealStatus = Database['public']['Enums']['deal_status'];
