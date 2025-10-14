import { Test, TestingModule } from '@nestjs/testing';
import { JetStreamService } from './jetstream.service';

describe('JetStreamService', () => {
  let service: JetStreamService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [JetStreamService],
    }).compile();

    service = module.get<JetStreamService>(JetStreamService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
