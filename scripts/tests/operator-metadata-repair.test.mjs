import test from 'node:test';
import assert from 'node:assert/strict';
import { applyOperatorMetadataRepair, isMissingOperatorOverview } from '../operator-metadata-repair.mjs';

const protectedFields = (item) => ({
  downloads: structuredClone(item.downloads), streamUrl: item.streamUrl, access: item.access,
  operatorOnly: item.operatorOnly, operatorAccess: item.operatorAccess,
  categoryKeys: structuredClone(item.categoryKeys), categoryLabels: structuredClone(item.categoryLabels),
  availableLanguages: structuredClone(item.availableLanguages),
});

test('exact same-title/year donor fills only missing operator metadata', () => {
  const standard = { id:'normal-1',type:'movie',year:2019,nameFa:'ایده اصلی',name:'Main Idea',overview:'یک خلاصه معتبر و کامل برای نسخه عادی.',imdb:'tt1234567',people:[{id:'p1',nameFa:'بازیگر نمونه',role:'actor'}],downloads:[{id:'normal-media',files:[{url:'https://example.com/normal.mp4'}]}] };
  const operator = { id:'operator-1--operator',type:'movie',year:2019,nameFa:'ایده اصلی',overview:'توضیحی ثبت نشده است.',people:[],access:'operator',operatorOnly:true,operatorAccess:'stream',categoryKeys:['movies','mobile-operator'],categoryLabels:['فیلم','ویژه اینترنت همراه'],availableLanguages:[],streamUrl:'https://aparatchi.upera.tv/stream/movie/operator-1',downloads:[{id:'operator-mobile-access',files:[{mode:'operator-play',url:'https://aparatchi.upera.tv/stream/movie/operator-1'}]}] };
  const before = protectedFields(operator);
  const stats = applyOperatorMetadataRepair([standard, operator]);
  assert.equal(operator.overview, standard.overview);
  assert.equal(operator.imdb, 'tt1234567');
  assert.equal(operator.people[0].nameFa, 'بازیگر نمونه');
  assert.deepEqual(protectedFields(operator), before);
  assert.equal(stats.donorMatches, 1);
});

test('wrong year is never accepted as a donor', () => {
  const standard={id:'n',type:'movie',year:2018,nameFa:'عنوان یکسان',overview:'خلاصه واقعی',people:[{nameFa:'الف',role:'actor'}]};
  const operator={id:'o--operator',type:'movie',year:2019,nameFa:'عنوان یکسان',operatorOnly:true,overview:'توضیحی ثبت نشده است.',people:[]};
  applyOperatorMetadataRepair([standard,operator]);
  assert.equal(operator.overview,'توضیحی ثبت نشده است.');
  assert.deepEqual(operator.people,[]);
});

test('ordinary catalog item is never modified', () => {
  const normal={id:'normal',type:'movie',year:2020,nameFa:'فیلم عادی',overview:'توضیحی ثبت نشده است.',people:[]};
  const before=structuredClone(normal);
  applyOperatorMetadataRepair([normal]);
  assert.deepEqual(normal,before);
});

test('verified Kan Pamenar record gets trusted metadata without touching operator media', () => {
  const item={id:'b8327f70-010c-11f1-a9bd-99c9fc183b8b--operator',type:'movie',year:2021,nameFa:'کن پامنار',contentVariant:'operator',operatorOnly:true,operatorAccess:'stream',access:'operator',overview:'توضیحی ثبت نشده است.',people:[],categoryKeys:['movies','iranian-movies','mobile-operator'],categoryLabels:['فیلم','ایرانی','ویژه اینترنت همراه'],availableLanguages:[],downloads:[{id:'operator-mobile-access',files:[{mode:'operator-play',url:'https://aparatchi.upera.tv/stream/movie/b8327f70'}]}]};
  const before=protectedFields(item);
  const stats=applyOperatorMetadataRepair([item]);
  assert.equal(item.imdb,'tt27851124');
  assert.ok(!isMissingOperatorOverview(item.overview));
  assert.ok(item.people.some((p)=>p.role==='director'&&p.nameFa==='اشکان درویشی'));
  assert.ok(item.people.some((p)=>p.role==='actor'&&p.nameFa==='سیامک صفری'));
  assert.deepEqual(protectedFields(item),before);
  assert.equal(stats.overrideMatches,1);
});

test('verified override is strict about year', () => {
  const item={id:'x--operator',type:'movie',year:2020,nameFa:'کن پامنار',operatorOnly:true,overview:'توضیحی ثبت نشده است.',people:[]};
  applyOperatorMetadataRepair([item]);
  assert.equal(item.imdb,undefined);
  assert.equal(item.overview,'توضیحی ثبت نشده است.');
  assert.deepEqual(item.people,[]);
});
