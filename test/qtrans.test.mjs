import test from 'node:test';
import assert from 'node:assert/strict';
import { validateQtrans } from '../src/qtrans.mjs';
test('QTrans adapter accepts only confirmed domestic public paths, not arbitrary AWS', () => {
  assert.ok(validateQtrans('qtrans://anonymous@qt.cncb.ac.cn:443/gsa/CRA002032/CRR077958'));
  for (const url of ['https://sra-pub-run-odp.s3.amazonaws.com/sra/SRR1/SRR1',
    'qtrans://anonymous@qt.cncb.ac.cn:443/INSDC5/SRR1', 'qtrans://anonymous@evil.test/gsa/a']) {
    assert.throws(() => validateQtrans(url));
  }
});
