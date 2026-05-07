import request from 'supertest';
import app from '../index';

describe('Health Endpoint', () => {
  it('should return 200 OK and database connected status', async () => {
    const response = await request(app).get('/api/health');
    expect(response.status).toBe(200);
    expect(response.body.status).toBe('ok');
    expect(response.body.database).toBe('connected');
  });
});
