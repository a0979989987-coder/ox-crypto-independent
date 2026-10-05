import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fixtureIDs} from '../scripts/lib/admin-review-fixtures.mjs';
import {randomUUID} from 'node:crypto';
import {Client} from 'pg';
import {initializeCandidate} from '../scripts/lib/admin-review-candidate-fixtures.mjs';
const config={host:'127.0.0.1',port:55439,user:'ox_fixture_owner',database:'postgres'};
test('candidate migration executes with non-superuser database owner and explicit executor administration',async()=>{
 const root=new Client(config);await root.connect();const suffix=randomUUID().replaceAll('-',''),role='ox_migration_'+suffix,executor='ox_executor_'+suffix,database='ox_migration_test_'+suffix;let connection;
 try {
  assert.ok((await root.query('show data_directory')).rows[0].data_directory.replaceAll('\\','/').toLowerCase().endsWith('/task-2/imports/postgres-tools/candidate-data'));
  await root.query('create role '+role+' nologin noinherit nosuperuser nobypassrls nocreatedb createrole');
  await root.query('create database '+database+' owner '+role);
  connection=new Client({...config,database});await connection.connect();await connection.query('set role '+role);
  const attributes=(await connection.query('select rolsuper,rolbypassrls,rolcreaterole from pg_roles where rolname=current_user')).rows[0];assert.deepEqual(attributes,{rolsuper:false,rolbypassrls:false,rolcreaterole:true});
  const candidateSQL=readFileSync(new URL('../supabase/migrations/20261002033814_ox_admin_review_candidate.sql',import.meta.url),'utf8').replaceAll('ox_review_executor',executor);
  await initializeCandidate({exec:sql=>connection.query(sql),query:(sql,p)=>connection.query(sql,p)},{candidateSQL});await connection.query('set role '+role);
  const membership=(await connection.query('select bool_or(set_option) set_option,bool_or(inherit_option) inherit_option from pg_auth_members where roleid=(select oid from pg_roles where rolname=$1) and member=(select oid from pg_roles where rolname=current_user)',[executor])).rows[0];assert.deepEqual(membership,{set_option:true,inherit_option:false});
  assert.equal((await connection.query("select has_function_privilege('anon','public.ox_admin_review_rpc(text,jsonb)','EXECUTE') allowed")).rows[0].allowed,false);
  assert.equal((await connection.query("select has_function_privilege('authenticated','public.ox_admin_review_rpc(text,jsonb)','EXECUTE') allowed")).rows[0].allowed,true);
  const state=(await connection.query("select pg_get_userbyid(proowner) owner from pg_proc where oid='public.ox_admin_review_rpc(text,jsonb)'::regprocedure")).rows[0];assert.equal(state.owner,executor);
  assert.equal((await connection.query('select count(*)::int n from ox_review_live.administrators')).rows[0].n,0);
  assert.equal((await connection.query("select has_table_privilege($1,'ox_review_live.audit','UPDATE,DELETE,TRUNCATE') mutable",[executor])).rows[0].mutable,false);
  await connection.query("create function auth.jwt() returns jsonb language sql as $$select '{}'::jsonb$$;grant execute on function auth.jwt() to "+executor);
  await connection.query('alter default privileges in schema ox_review_live grant all on sequences to anon');
  await connection.query(readFileSync(new URL('../docs/account/feature-access-schema-draft.sql',import.meta.url),'utf8').replaceAll('ox_review_executor',executor));await connection.query('set role '+role);
  assert.equal((await connection.query("select pg_get_userbyid(proowner) owner from pg_proc where oid='public.ox_feature_access_rpc(text,jsonb)'::regprocedure")).rows[0].owner,executor);
  assert.equal((await connection.query("select has_schema_privilege($1,'public','CREATE') allowed",[executor])).rows[0].allowed,false);
  assert.equal((await connection.query("select has_sequence_privilege('anon','ox_review_live.feature_audit_sequence_seq','SELECT,USAGE,UPDATE') allowed")).rows[0].allowed,false);
  assert.equal((await connection.query("select count(*)::int n from ox_review_live.features where mode='public'")).rows[0].n,18);
  await connection.query('revoke usage on schema auth from '+executor);
  await connection.query(readFileSync(new URL('../docs/account/review-claims-compatibility.sql',import.meta.url),'utf8').replaceAll('ox_review_executor',executor));await connection.query('set role '+role);
  assert.equal((await connection.query("select has_schema_privilege($1,'auth','USAGE') allowed",[executor])).rows[0].allowed,false);
  assert.equal((await connection.query("select has_schema_privilege($1,'public','CREATE') allowed",[executor])).rows[0].allowed,false);
  assert.equal((await connection.query("select has_table_privilege($1,'auth.users','SELECT') allowed",[executor])).rows[0].allowed,false);
  await connection.query('alter table auth.users add column email text;create table auth.identities(user_id uuid,provider text,identity_data jsonb);alter table auth.users add column email_confirmed_at timestamptz');
  await connection.query('update auth.users set email=$1,email_confirmed_at=now() where id=$2',['admin@example.test',fixtureIDs.admin]);await connection.query("insert into auth.identities values($1,'google','{\"email\":\"admin@example.test\",\"email_verified\":true}')",[fixtureIDs.admin]);
  await connection.query(readFileSync(new URL('../docs/account/admin-release/02-bootstrap.sql',import.meta.url),'utf8').replaceAll('REPLACE_WITH_VERIFIED_GOOGLE_EMAIL','admin@example.test'));
  assert.equal((await connection.query('select count(*)::int n from ox_review_live.administrators where active')).rows[0].n,1);
  const policy=(await connection.query('select ordinary_configured,ordinary_capabilities,exclusive_uid from ox_review_live.policy')).rows[0];assert.deepEqual(policy,{ordinary_configured:true,ordinary_capabilities:[],exclusive_uid:true});
  assert.equal((await connection.query('select count(*)::int n from ox_review_live.approvals')).rows[0].n,0);
  await connection.query(readFileSync(new URL('../docs/account/admin-release/03-verify.sql',import.meta.url),'utf8').replaceAll('ox_review_executor',executor));
  await connection.query(readFileSync(new URL('../docs/account/admin-release/04-disable.sql',import.meta.url),'utf8').replaceAll('ox_review_executor',executor));
  assert.equal((await connection.query("select has_function_privilege('authenticated','public.ox_admin_review_rpc(text,jsonb)','EXECUTE') allowed")).rows[0].allowed,false);

 }finally {if(connection)await connection.end();await root.query('drop database if exists '+database);await root.query('drop role if exists '+executor);await root.query('drop role if exists '+role);await root.end();}
});
